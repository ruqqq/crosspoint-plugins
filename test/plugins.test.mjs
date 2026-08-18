// Smoke tests for the plugins in this catalog. Zero dependencies — the plugin
// source is run in a vm context with only the globals the device page provides,
// which also proves each plugin stays free of imports and frameworks.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);

async function loadPlugin(path, globals = {}) {
  let render;
  const context = vm.createContext({
    CrossPoint: {
      registerPlugin(fn) { render = fn; },
    },
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    DataView,
    Map,
    Date,
    Math,
    Array,
    String,
    Number,
    Object,
    Promise,
    encodeURIComponent,
    decodeURIComponent,
    atob,
    btoa,
    setTimeout,
    ...globals,
  });
  const source = await readFile(new URL(path, root), 'utf8');
  vm.runInContext(source, context, { filename: path });
  assert.equal(typeof render, 'function', path + ' should register a render function');
  return { render, context };
}

// Asserts on unknown lookups, so a test must list every id its code path touches.
function fakeDocument(ids) {
  const elements = Object.fromEntries(ids.map((id) => [id, {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    style: {},
    onclick: null,
    onchange: null,
  }]));
  return {
    elements,
    getElementById(id) {
      assert.ok(elements[id], 'unexpected element lookup: ' + id);
      return elements[id];
    },
  };
}

function response({ status = 200, json, body = new ArrayBuffer(0), text = '' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return json; },
    async arrayBuffer() { return body; },
    async text() { return text; },
  };
}

test('the catalog matches the plugin folders it ships', async () => {
  const catalog = JSON.parse(await readFile(new URL('catalog.json', root), 'utf8'));
  assert.ok(catalog.plugins.length, 'catalog lists no plugins');
  for (const p of catalog.plugins) {
    assert.match(p.name, /^[a-z0-9-]+$/, p.name + ' is not a valid folder name');
    assert.ok(p.base.startsWith('https://'), p.name + ' needs an absolute base URL');
    assert.ok(p.base.endsWith('/' + p.name + '/'), p.name + ' base URL should end in its folder');

    const manifest = JSON.parse(await readFile(new URL(p.name + '/manifest.json', root), 'utf8'));
    assert.ok(manifest.title.trim(), p.name + ' needs a non-empty title');
    assert.ok(['files', 'settings'].includes(manifest.mount), p.name + ' has an invalid mount');
    // The store compares the installed manifest against the catalog to decide
    // whether an update is available; a mismatch offers one forever.
    assert.equal(manifest.version, p.version, p.name + ' manifest/catalog version drift');

    for (const file of p.files) {
      const contents = await readFile(new URL(p.name + '/' + file, root), 'utf8');
      assert.ok(contents.length, p.name + '/' + file + ' is empty');
      // MAX_MANIFEST_SIZE in the firmware.
      if (file === 'device.json') {
        const bytes = Buffer.byteLength(contents);
        assert.ok(bytes < 8192, p.name + '/device.json is ' + bytes + ' bytes (cap 8192)');
        assert.equal(JSON.parse(contents).version, p.version, p.name + ' device.json version drift');
      }
    }
  }
});

const KOPI_IDS = ['kopi-status', 'kopi-url', 'kopi-user', 'kopi-pass', 'kopi-save', 'kopi-test', 'kopi-clear'];

async function renderKopi({ relay, existing } = {}) {
  const document = fakeDocument(KOPI_IDS);
  const writes = [];
  const api = {
    relay,
    async writeFile(path, dataB64) {
      writes.push({ path, data: Buffer.from(dataB64, 'base64').toString('utf8') });
      return { ok: true, bytes: dataB64.length };
    },
  };
  async function fetch(url) {
    if (url === '/download?path=' + encodeURIComponent('/.crosspoint/kopi.json')) {
      return existing ? response({ text: existing }) : response({ status: 404 });
    }
    throw new Error('unexpected fetch: ' + url);
  }
  const { render } = await loadPlugin('kopi/plugin.js', { document, fetch });
  await render({ innerHTML: '' }, api);
  return { document, writes };
}

const OK_FEED = async () => ({ status: 200, body: '{"page":1,"items":[{"title":"Kopi","url":"u"}]}', headers: [] });

test('kopi prefills a default server URL when nothing is configured', async () => {
  const { document } = await renderKopi();
  assert.equal(document.elements['kopi-url'].value, 'https://kopi.ruqqq.workers.dev');
  assert.match(document.elements['kopi-status'].textContent, /Not configured/);
});

test('kopi refuses to save without a username or password', async () => {
  const { document, writes } = await renderKopi({ relay: OK_FEED });

  await document.elements['kopi-save'].onclick();
  assert.match(document.elements['kopi-status'].textContent, /Username and password are required/);

  document.elements['kopi-user'].value = 'reader';
  await document.elements['kopi-save'].onclick();
  assert.match(document.elements['kopi-status'].textContent, /Password is required/);

  // Nothing reached the SD card while the form was incomplete.
  assert.equal(writes.length, 0);
});

test('kopi refuses to save credentials the server rejects', async () => {
  const denied = async () => ({ status: 401, body: 'Unauthorized', headers: [] });
  const { document, writes } = await renderKopi({ relay: denied });
  document.elements['kopi-user'].value = 'reader';
  document.elements['kopi-pass'].value = 'wrong';
  await document.elements['kopi-save'].onclick();

  assert.match(document.elements['kopi-status'].textContent, /incorrect/);
  assert.match(document.elements['kopi-status'].textContent, /Nothing was saved/);
  assert.equal(writes.length, 0);
});

test('kopi saves but warns when the server cannot be reached', async () => {
  const down = async () => ({ status: 502, body: '', headers: [] });
  const { document, writes } = await renderKopi({ relay: down });
  document.elements['kopi-user'].value = 'reader';
  document.elements['kopi-pass'].value = 'pw';
  await document.elements['kopi-save'].onclick();

  // An offline server must not block configuring the device.
  assert.equal(writes.length, 1);
  assert.match(document.elements['kopi-status'].textContent, /Saved, but could not verify/);
});

test('kopi flags a stored config that is missing credentials', async () => {
  const { document } = await renderKopi({ existing: '{"url":"https://kopi.example.com"}' });
  assert.match(document.elements['kopi-status'].textContent, /missing/);
});

test('kopi normalizes a pasted feed URL and stores basic credentials', async () => {
  const { document, writes } = await renderKopi({ relay: OK_FEED });

  document.elements['kopi-url'].value = 'https://kopi.example.com/opds/';
  document.elements['kopi-user'].value = 'reader';
  document.elements['kopi-pass'].value = 'abcde-fghij-klmno';
  await document.elements['kopi-save'].onclick();

  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/.crosspoint/kopi.json');
  const cfg = JSON.parse(writes[0].data);
  assert.equal(cfg.url, 'https://kopi.example.com');
  assert.equal(cfg.user, 'reader');
  assert.equal(cfg.pass, 'abcde-fghij-klmno');
  assert.equal(cfg.auth, Buffer.from('reader:abcde-fghij-klmno').toString('base64'));
  // device.json appends the catalog path itself, so the saved URL must be the bare origin.
  assert.equal(document.elements['kopi-url'].value, 'https://kopi.example.com');
});

test('kopi reports issue count and authentication failures', async () => {
  const list = JSON.stringify({ page: 1, items: [
    { id: 'issue-2', title: 'Kopi Singapore - 2026-08-14', url: 'https://kopi.example.com/opds/issue/2.epub' },
    { id: 'issue-1', title: 'Kopi Singapore - 2026-08-13', url: 'https://kopi.example.com/opds/issue/1.epub' },
  ] });
  const calls = [];
  const relay = async (method, url, headers) => {
    calls.push({ method, url, headers });
    return { status: 200, body: list, headers: [] };
  };

  const ok = await renderKopi({ relay, existing: '{"url":"https://kopi.example.com","user":"reader","pass":"pw","auth":"cmVhZGVyOnB3"}' });
  assert.match(ok.document.elements['kopi-status'].textContent, /Configured/);
  await ok.document.elements['kopi-test'].onclick();

  assert.equal(calls[0].method, 'GET');
  // The test button must probe exactly what the device browses, or a server
  // that cannot serve the reader still passes setup.
  assert.equal(calls[0].url, 'https://kopi.example.com/opds/list');
  assert.equal(calls[0].headers.Authorization, 'Basic ' + Buffer.from('reader:pw').toString('base64'));
  assert.match(ok.document.elements['kopi-status'].textContent, /Found 2 issues/);

  const denied = await renderKopi({ relay: async () => ({ status: 401, body: 'Unauthorized', headers: [] }) });
  denied.document.elements['kopi-url'].value = 'https://kopi.example.com';
  denied.document.elements['kopi-user'].value = 'reader';
  denied.document.elements['kopi-pass'].value = 'wrong';
  await denied.document.elements['kopi-test'].onclick();
  assert.match(denied.document.elements['kopi-status'].textContent, /Username or password is incorrect/);
});

test('kopi refuses a server too old to serve the catalog the device browses', async () => {
  // An older Kopi deployment still answers /opds but has no /opds/list. Saving
  // that would leave the reader with an empty browse screen and no explanation.
  const { document, writes } = await renderKopi({
    relay: async () => ({ status: 404, body: 'Not Found', headers: [] }),
  });
  document.elements['kopi-user'].value = 'reader';
  document.elements['kopi-pass'].value = 'pw';
  await document.elements['kopi-save'].onclick();

  assert.match(document.elements['kopi-status'].textContent, /\/opds\/list/);
  assert.equal(writes.length, 0);
});

test('kopi browses the catalog as json, so the device keeps the server order', async () => {
  // The reader's XML-list mode sorts alphabetically by title, and a Kopi title
  // ends in the issue date — under "xml" a newest-first catalog renders
  // oldest-first, and that mode also drops paging entirely.
  const device = JSON.parse(await readFile(new URL('../kopi/device.json', import.meta.url), 'utf8'));
  assert.equal(device.browse.format, 'json');
  assert.equal(device.browse.items, 'items');
  assert.equal(device.browse.fields.url, 'url');
  assert.match(device.browse.url, /\/opds\/list\?page=\{page\}&limit=\{limit\}/);
  // JSON items carry the file URL but, unlike the XML mode, nothing defaults
  // the download template to it.
  assert.equal(device.download.url, '{url}');
});

// Appended to crosspoint-plugins/test/plugins.test.mjs

const LIBBY_IDS = [
  'lib-account-state', 'lib-user', 'lib-pass', 'lib-go', 'lib-acsm',
  'lib-refresh', 'lib-fulfill', 'lib-status',
  'lby-state', 'lby-code', 'lby-code-value', 'lby-link', 'lby-unlink',
  'lby-loans', 'lby-refresh', 'lby-get',
];

// A loan set covering every branch of loanFormat: one Adobe ebook, one
// DRM-free ebook, one that only exists in Libby's web reader, and one
// audiobook. Only the first two are sendable.
const SYNC_PAYLOAD = {
  result: 'synchronized',
  cards: [{ advantageKey: 'sgpl', library: { name: 'Singapore Libraries' } }],
  loans: [
    {
      id: '111', cardId: '900', title: 'Adobe Book', firstCreatorName: 'A. Writer',
      expireDate: '2026-09-07T12:00:00Z', type: { id: 'ebook' },
      formats: [{ id: 'ebook-overdrive' }, { id: 'ebook-epub-adobe' }],
    },
    {
      id: '222', cardId: '900', title: 'Open Book', firstCreatorName: 'O. Author',
      expireDate: '2026-09-08T12:00:00Z', type: { id: 'ebook' },
      formats: [{ id: 'ebook-epub-open' }, { id: 'ebook-epub-adobe' }],
    },
    {
      id: '333', cardId: '900', title: 'Web Only', type: { id: 'ebook' },
      formats: [{ id: 'ebook-overdrive' }],
    },
    {
      id: '444', cardId: '900', title: 'An Audiobook', type: { id: 'audiobook' },
      formats: [{ id: 'audiobook-overdrive' }],
    },
  ],
};

const ACSM_XML =
  '<adept:fulfillmentToken xmlns:adept="http://ns.adobe.com/adept">' +
  '<adept:operatorURL>https://fulfill.example.overdrive.com/acs/</adept:operatorURL>' +
  '<adept:hmac>aG1hYw==</adept:hmac></adept:fulfillmentToken>';

function adeptRelay(url, state) {
  if (url.endsWith('/ActivationServiceInfo')) {
    return '<adept:service xmlns:adept="http://ns.adobe.com/adept">' +
      '<adept:authURL>https://adeactivate.adobe.com/adept</adept:authURL>' +
      '<adept:userInfoURL>https://adeactivate.adobe.com/user</adept:userInfoURL>' +
      '<adept:certificate>Y2VydA==</adept:certificate></adept:service>';
  }
  if (url.endsWith('/AuthenticationServiceInfo')) {
    return '<adept:service xmlns:adept="http://ns.adobe.com/adept">' +
      '<adept:certificate>YXV0aC1jZXJ0</adept:certificate></adept:service>';
  }
  if (url.endsWith('/SignInDirect')) {
    return '<adept:credentials xmlns:adept="http://ns.adobe.com/adept">' +
      '<adept:user>urn:uuid:user</adept:user><adept:pkcs12>cDEy</adept:pkcs12>' +
      '<adept:licenseCertificate>bGljLWNlcnQ=</adept:licenseCertificate>' +
      '<adept:encryptedPrivateLicenseKey>ZW5j</adept:encryptedPrivateLicenseKey>' +
      '</adept:credentials>';
  }
  if (url.endsWith('/Activate')) {
    return '<adept:activationToken xmlns:adept="http://ns.adobe.com/adept">' +
      '<adept:device>urn:uuid:device</adept:device></adept:activationToken>';
  }
  if (url.includes('/LicenseServiceInfo?')) {
    return '<adept:licenseServiceInfo xmlns:adept="http://ns.adobe.com/adept">' +
      '<adept:certificate>bGljZW5zZS1jZXJ0</adept:certificate></adept:licenseServiceInfo>';
  }
  if (url.endsWith('/Fulfill')) {
    return '<adept:fulfillmentResult xmlns:adept="http://ns.adobe.com/adept" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/"><adept:resourceItemInfo>' +
      '<adept:src>https://download.example.overdrive.com/book.epub</adept:src>' +
      '<adept:licenseToken><adept:licenseURL>' +
      'https://license.example.overdrive.com/service</adept:licenseURL>' +
      '<adept:encryptedKey>a2V5</adept:encryptedKey></adept:licenseToken>' +
      '</adept:resourceItemInfo><dc:title>Adobe Book</dc:title></adept:fulfillmentResult>';
  }
  if (url.endsWith('/Auth') || url.endsWith('/InitLicenseService')) {
    return '<adept:ok xmlns:adept="http://ns.adobe.com/adept"/>';
  }
  return null;
}

const CRYPTO = async (op, fields = {}) => {
  const zeros = (length) => btoa(String.fromCharCode(...new Uint8Array(length)));
  if (op === 'random') return { data: zeros(fields.len) };
  if (op === 'sha1') return { data: zeros(20) };
  if (op === 'keygen') return { public: 'cHVibGlj', private: 'cHJpdmF0ZQ==' };
  if (op === 'pubencrypt') return { data: zeros(128) };
  if (op === 'aesenc') return { data: zeros(16) };
  if (op === 'aesdec') return { data: 'cHJpdmF0ZQ==' };
  if (op === 'pkcs12') return { key: 'c2lnbmluZy1rZXk=', cert: 'c2lnbmluZy1jZXJ0' };
  if (op === 'sign') return { data: zeros(128) };
  throw new Error('unexpected crypto op: ' + op);
};

// One harness for every Libby test. `libbyHandler` decides what the Libby host
// answers so each test can shape only the calls it cares about.
async function renderLibby({ libbyHandler, storedLibby, storedCredential } = {}) {
  const document = fakeDocument(LIBBY_IDS);
  const state = {
    writes: [], downloads: [], deletes: [], relayCalls: [], chipCalls: [],
    fulfillmentOperations: [], mkdirs: [],
    savedCredential: storedCredential || '',
    storedLibby: storedLibby || null,
  };

  const relay = async (method, url, headers = {}, body = '') => {
    state.relayCalls.push({ method, url, headers, body });
    // The firmware sets its own User-Agent; sending one appends a duplicate.
    assert.equal(
      Object.keys(headers).some((n) => n.toLowerCase() === 'user-agent'), false,
      'must not send a User-Agent: ' + url);
    // The CDN the open-format link redirects to; the final hop just resolves.
    if (url.startsWith('https://cdn.example/')) return { status: 200, body: '', headers: [] };
    if (url.startsWith('https://sentry.libbyapp.com') ||
        url.startsWith('https://fulfill.libby')) {
      if (!libbyHandler) throw new Error('unexpected libby call: ' + url);
      return libbyHandler(method, url, headers, body, state);
    }
    const xml = adeptRelay(url, state);
    if (xml === null) throw new Error('unexpected relay: ' + method + ' ' + url);
    return { status: 200, body: xml, headers: [] };
  };

  const api = {
    crypto: CRYPTO,
    relay,
    async writeFile(path, data) {
      state.writes.push({ path, data });
      const text = Buffer.from(data, 'base64').toString('utf8');
      if (path === '/.crosspoint/content.key') state.savedCredential = text;
      if (path === '/.crosspoint/libby.json') {
        state.storedLibby = text === '{}' ? null : JSON.parse(text);
      }
      if (path.endsWith('.rights')) state.fulfillmentOperations.push('rights');
      return { ok: true, bytes: data.length };
    },
    async fetchToSd(url, dest, headers) {
      state.downloads.push({ url, dest, headers });
      state.fulfillmentOperations.push('download');
      return { status: 200, bytes: 4321 };
    },
  };

  async function fetch(url, options = {}) {
    if (url === '/mkdir') {
      state.mkdirs.push(new URLSearchParams(options.body).get('path'));
      return response();
    }
    if (url === '/delete') {
      state.deletes.push(new URLSearchParams(options.body).get('path'));
      return response();
    }
    if (url.startsWith('/api/files')) {
      const path = new URLSearchParams(url.split('?')[1]).get('path');
      if (path === '/.crosspoint') {
        return response({ json: state.savedCredential
          ? [{ name: 'content.key', isDirectory: false }] : [] });
      }
      return response({ json: [] });
    }
    if (url.startsWith('/download')) {
      const path = new URLSearchParams(url.split('?')[1]).get('path');
      if (path === '/.crosspoint/content.key') {
        return state.savedCredential
          ? response({ text: state.savedCredential }) : response({ status: 404 });
      }
      if (path === '/.crosspoint/libby.json') {
        return state.storedLibby
          ? response({ text: JSON.stringify(state.storedLibby) })
          : response({ status: 404 });
      }
      return response({ status: 404 });
    }
    throw new Error('unexpected fetch: ' + url);
  }

  const { render } = await loadPlugin('libby/plugin.js', {
    document,
    window: { location: { search: '?path=%2FBooks' } },
    fetch,
  });
  await render({ innerHTML: '' }, api);
  return { document, state, api };
}

// Activates the Adobe account so the download tests have a session, and returns
// the resulting credential text for reuse.
async function activatedCredential() {
  const { document, state } = await renderLibby({ libbyHandler: () => {
    throw new Error('no libby calls expected during activation');
  } });
  document.elements['lib-user'].value = 'reader@example.com';
  document.elements['lib-pass'].value = 'secret';
  await document.elements['lib-go'].onclick();
  assert.match(state.savedCredential, /^FREEINK-CONTENT-KEY 1/m);
  return state.savedCredential;
}

// A realistic identity: the plugin reads chip.id out of the JWT to name the
// chip it is replacing.
const LINKED_IDENTITY = 'eyJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJyZWFkaXZlcnNlIiwiaXNzIjoic2VudHJ5IiwiY2hpcCI6eyJpZCI6ImFiY2QxMjM0LWIzN2EtNDZiOS04NDZlLWIxMDAwMjFhNzYyMSJ9LCJleHAiOjk5OTk5OTk5OTl9.sig';
const LINKED = { identity: LINKED_IDENTITY, chipId: 'abcd1234-b37a-46b9-846e-b100021a7621', cards: [{ name: 'sgpl', library: 'Singapore Libraries' }] };

function libbyOk(overrides = {}) {
  return (method, url, headers, body, state) => {
    const json = (obj) => ({ status: 200, body: JSON.stringify(obj), headers: [] });
    if (overrides.before) {
      const r = overrides.before(method, url, headers, body, state);
      if (r) return r;
    }
    if (url.includes('/chip?')) {
      // Libby rejects a chip that does not declare its client version.
      assert.match(url, /[?&]c=d%3A22\.0\.3/, 'chip request must declare a client version');
      state.chipCalls.push(url);
      return json({ chip: 'chip-1', identity: 'tok-' + state.relayCalls.length });
    }
    if (url.includes('/chip/clone/code')) {
      const code = new URLSearchParams(url.split('?')[1]).get('code');
      if (!code) return json({ result: 'regenerated', code: '45723223', expiry: 1 });
      return json({ result: 'fulfilled', blessing: 'bless-me' });
    }
    if (url.endsWith('/chip/clone')) return json({ result: 'cloned' });
    if (url.endsWith('/chip/sync')) return json(SYNC_PAYLOAD);
    if (url.includes('/fulfill/ebook-epub-adobe')) {
      return json({ fulfill: { href: 'https://fulfill.libby.example/acsm/111' } });
    }
    if (url.includes('/fulfill/ebook-epub-open')) {
      return json({ fulfill: { href: 'https://fulfill.libby.example/open/222' } });
    }
    if (url.startsWith('https://fulfill.libby.example/acsm/')) {
      return { status: 200, body: ACSM_XML, headers: [] };
    }
    if (url.startsWith('https://fulfill.libby.example/open/')) {
      // HEAD probe from resolveRedirects, then the CDN hop.
      return { status: 302, body: '', headers: [['location', 'https://cdn.example/open.epub']] };
    }
    throw new Error('unexpected libby call: ' + method + ' ' + url);
  };
}

test('libby links with a setup code and stores the token outside content.key', async () => {
  const { document, state } = await renderLibby({ libbyHandler: libbyOk() });
  assert.match(document.elements['lby-state'].textContent, /Not linked/);

  await document.elements['lby-link'].onclick();

  // The code is shown to the user in groups of four to be read off a screen.
  assert.equal(document.elements['lby-code-value'].textContent, '4572-3223');
  assert.match(document.elements['lby-state'].textContent, /Singapore Libraries/);

  const tokenWrites = state.writes.filter((w) => w.path === '/.crosspoint/libby.json');
  assert.ok(tokenWrites.length, 'the identity token must be persisted');
  assert.ok(state.storedLibby.identity, 'stored config carries an identity');
  // The Adobe credential is a contract with the on-device SDK; Libby's token
  // has no business in it.
  assert.equal(state.writes.some((w) => w.path === '/.crosspoint/content.key'), false);
});

test('libby lists only loans this device can actually open', async () => {
  const { document } = await renderLibby({ libbyHandler: libbyOk(), storedLibby: LINKED });
  const labels = document.elements['lby-loans'].innerHTML;

  assert.match(labels, /Adobe Book/);
  assert.match(labels, /Open Book/);
  // Web-reader-only titles and audiobooks cannot become a file.
  assert.equal(/Web Only/.test(labels), false);
  assert.equal(/An Audiobook/.test(labels), false);
  // Due dates come from expireDate, trimmed to the day.
  assert.match(labels, /due 2026-09-07/);
});

test('libby sends a protected loan through fulfillment, rights first', async () => {
  const credential = await activatedCredential();
  const { document, state } = await renderLibby({
    libbyHandler: libbyOk(), storedLibby: LINKED, storedCredential: credential,
  });

  document.elements['lby-loans'].value = '0'; // Adobe Book
  document.elements['lby-loans'].onchange();
  assert.equal(document.elements['lby-get'].disabled, false);
  await document.elements['lby-get'].onclick();

  assert.deepEqual(state.mkdirs, ['/Libby']);
  assert.deepEqual(state.fulfillmentOperations, ['rights', 'download']);
  assert.equal(state.downloads.length, 1);
  assert.equal(state.downloads[0].dest, '/Libby/Adobe Book.epub');
  assert.ok(state.writes.some((w) => w.path === '/Libby/Adobe Book.epub.rights'));
  assert.match(document.elements['lib-status'].textContent, /Sent “Adobe Book”/);
});

test('libby downloads a DRM-free loan directly, with no rights sidecar', async () => {
  const credential = await activatedCredential();
  const { document, state } = await renderLibby({
    libbyHandler: libbyOk(), storedLibby: LINKED, storedCredential: credential,
  });

  document.elements['lby-loans'].value = '1'; // Open Book, offered open + adobe
  document.elements['lby-loans'].onchange();
  await document.elements['lby-get'].onclick();

  // Open beats Adobe, so no fulfillment happened at all.
  assert.deepEqual(state.fulfillmentOperations, ['download']);
  assert.equal(state.downloads[0].dest, '/Libby/Open Book.epub');
  // The signed link redirects to a CDN and fetchToSd cannot follow redirects.
  assert.equal(state.downloads[0].url, 'https://cdn.example/open.epub');
  assert.equal(state.writes.some((w) => w.path.endsWith('.rights')), false);
});

test('libby recovers from an expired chip and keeps the refreshed token', async () => {
  let rejected = false;
  const handler = libbyOk({
    before: (method, url) => {
      // The first sync fails the way an expired identity fails.
      if (url.endsWith('/chip/sync') && !rejected) {
        rejected = true;
        return { status: 403, body: '{"result":"missing_chip"}', headers: [] };
      }
      return null;
    },
  });
  const { document, state } = await renderLibby({ libbyHandler: handler, storedLibby: LINKED });

  assert.equal(rejected, true, 'the 403 branch must have been exercised');
  assert.match(document.elements['lby-loans'].innerHTML, /Adobe Book/);
  // A refreshed identity is worthless unless it is written back.
  assert.notEqual(state.storedLibby.identity, LINKED.identity);
});

test('libby keeps send disabled until both the account and the link exist', async () => {
  // Linked, but the Adobe account was never activated.
  const noAccount = await renderLibby({ libbyHandler: libbyOk(), storedLibby: LINKED });
  noAccount.document.elements['lby-loans'].value = '0';
  noAccount.document.elements['lby-loans'].onchange();
  await noAccount.document.elements['lby-get'].onclick();
  assert.match(noAccount.document.elements['lib-status'].textContent, /Activate the device first/);
  assert.equal(noAccount.state.downloads.length, 0);

  // Activated, but Libby was never linked.
  const credential = await activatedCredential();
  const noLink = await renderLibby({
    libbyHandler: () => { throw new Error('no libby calls expected'); },
    storedCredential: credential,
  });
  assert.equal(noLink.document.elements['lby-get'].disabled, true);
  assert.match(noLink.document.elements['lby-loans'].innerHTML, /Link Libby/);
});

test('libby names the chip it replaces when refreshing a known identity', async () => {
  let rejected = false;
  const handler = libbyOk({
    before: (method, url) => {
      if (url.endsWith('/chip/sync') && !rejected) {
        rejected = true;
        return { status: 403, body: '{"result":"missing_chip"}', headers: [] };
      }
      return null;
    },
  });
  const { state } = await renderLibby({ libbyHandler: handler, storedLibby: LINKED });

  // The replacement request must carry both the client version and the id of
  // the chip being replaced, taken from the stored JWT.
  const refresh = state.chipCalls.find((u) => u.includes('&v='));
  assert.ok(refresh, 'the re-chip should name the chip it replaces');
  assert.match(refresh, /[?&]v=abcd1234(&|$)/);
  assert.match(refresh, /[?&]s=0/);
});

test('libby explains a version refusal instead of retrying it', async () => {
  let syncCalls = 0;
  const handler = libbyOk({
    before: (method, url) => {
      if (url.endsWith('/chip/sync')) {
        syncCalls += 1;
        return { status: 403, body: '{"result":"client_upgrade_required"}', headers: [] };
      }
      return null;
    },
  });
  const { document } = await renderLibby({ libbyHandler: handler, storedLibby: LINKED });

  // Only missing_chip is a stale token. Replaying a version refusal would fail
  // twice and bury the reason.
  assert.equal(syncCalls, 1, 'a version refusal must not be retried');
  const status = document.elements['lib-status'].textContent;
  assert.match(status, /needs an update/);
  assert.match(status, /manual authorization-file/);
  assert.equal(/client_upgrade_required/.test(status), false,
    'the raw code should not be shown to the user');
});

test('libby still refreshes when the stored token is unreadable', async () => {
  let rejected = false;
  const handler = libbyOk({
    before: (method, url) => {
      if (url.endsWith('/chip/sync') && !rejected) {
        rejected = true;
        return { status: 403, body: '{"result":"missing_chip"}', headers: [] };
      }
      return null;
    },
  });
  // A truncated or pre-upgrade token has no readable chip id.
  const { document, state } = await renderLibby({
    libbyHandler: handler, storedLibby: { identity: 'not-a-jwt', chipId: '' },
  });

  assert.equal(rejected, true);
  // The replacement goes out unversioned rather than throwing.
  assert.ok(state.chipCalls.some((u) => !u.includes('&v=')));
  assert.match(document.elements['lby-loans'].innerHTML, /Adobe Book/);
});

test('libby syncs once while linking, not twice', async () => {
  let syncs = 0;
  const handler = libbyOk({
    before: (method, url) => { if (url.endsWith('/chip/sync')) syncs += 1; return null; },
  });
  const { document } = await renderLibby({ libbyHandler: handler });

  await document.elements['lby-link'].onclick();

  // Every sync is a slow round trip on this device, and the loans are already
  // in the payload the link step fetched.
  assert.equal(syncs, 1, 'linking should not re-fetch the sync payload');
  assert.match(document.elements['lby-loans'].innerHTML, /Adobe Book/);
  assert.match(document.elements['lib-status'].textContent, /Linked\. 2 loans available/);
});

test('libby names each step while linking instead of going silent', async () => {
  // The status shown at the moment of each request, captured without timers.
  const ctx = {};
  const statusAtCall = [];
  const handler = libbyOk({
    before: (method, url) => {
      if (ctx.document) statusAtCall.push(ctx.document.elements['lib-status'].textContent);
      return null;
    },
  });
  const { document } = await renderLibby({ libbyHandler: handler });
  ctx.document = document;

  await document.elements['lby-link'].onclick();

  const joined = statusAtCall.join(' | ');
  // The bug was one message covering three round trips, so a long stall looked
  // like a hang.
  assert.match(joined, /Claiming the code/);
  assert.match(joined, /Refreshing the session/);
  assert.match(joined, /Reading your library/);
});

test('libby explains an oversized sync instead of leaking the relay error', async () => {
  const handler = libbyOk({
    before: (method, url) => {
      // What the device returns when a response exceeds its 32 KB buffer.
      if (url.endsWith('/chip/sync')) return { error: 'response too large, use /api/fetch' };
      return null;
    },
  });
  const { document } = await renderLibby({ libbyHandler: handler, storedLibby: LINKED });

  const status = document.elements['lib-status'].textContent;
  assert.match(status, /more data than this device can/);
  assert.equal(/api\/fetch/.test(status), false, 'internal advice should not reach the user');
});
