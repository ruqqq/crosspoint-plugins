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

test('kopi normalizes a pasted feed URL and stores basic credentials', async () => {
  const { document, writes } = await renderKopi();
  assert.match(document.elements['kopi-status'].textContent, /Not configured/);

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
  // device.json appends /opds itself, so the saved URL must be the bare origin.
  assert.equal(document.elements['kopi-url'].value, 'https://kopi.example.com');
});

test('kopi reports feed entry count and authentication failures', async () => {
  const feed =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<feed xmlns="http://www.w3.org/2005/Atom">' +
    '<entry><title>Kopi Singapore - 2026-08-14</title>' +
    '<link rel="http://opds-spec.org/acquisition" href="https://kopi.example.com/opds/issue/2.epub"/>' +
    '</entry>' +
    '<entry><title>Kopi Singapore - 2026-08-13</title>' +
    '<link rel="http://opds-spec.org/acquisition" href="https://kopi.example.com/opds/issue/1.epub"/>' +
    '</entry></feed>';
  const calls = [];
  const relay = async (method, url, headers) => {
    calls.push({ method, url, headers });
    return { status: 200, body: feed, headers: [] };
  };

  const ok = await renderKopi({ relay, existing: '{"url":"https://kopi.example.com","user":"reader","pass":"pw","auth":"cmVhZGVyOnB3"}' });
  assert.match(ok.document.elements['kopi-status'].textContent, /Configured/);
  await ok.document.elements['kopi-test'].onclick();

  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://kopi.example.com/opds');
  assert.equal(calls[0].headers.Authorization, 'Basic ' + Buffer.from('reader:pw').toString('base64'));
  assert.match(ok.document.elements['kopi-status'].textContent, /Found 2 issues/);

  const denied = await renderKopi({ relay: async () => ({ status: 401, body: 'Unauthorized', headers: [] }) });
  denied.document.elements['kopi-url'].value = 'https://kopi.example.com';
  denied.document.elements['kopi-user'].value = 'reader';
  denied.document.elements['kopi-pass'].value = 'wrong';
  await denied.document.elements['kopi-test'].onclick();
  assert.match(denied.document.elements['kopi-status'].textContent, /Authentication failed/);
});
