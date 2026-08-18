// Kopi setup for CrossPoint. Collects the Kopi server URL and OPDS credentials
// in the browser and writes them to /.crosspoint/kopi.json, which the on-device
// Kopi screen (device.json) reads to browse the OPDS feed and download issues.
// Browsing and downloading then happen on the reader under Settings > System >
// Plugins > Kopi — no computer needed after setup.
CrossPoint.registerPlugin(async (container, api) => {
  const CONFIG_PATH = '/.crosspoint/kopi.json';
  // Prefilled when nothing is configured yet; editable for another instance.
  const DEFAULT_URL = 'https://kopi.ruqqq.workers.dev';
  // The catalog the device browses. JSON, not the Atom feed: the reader's
  // XML-list mode re-sorts entries alphabetically by title, and a Kopi title
  // ends in the issue date, so the feed would render oldest-first. Keep in
  // step with browse.url in device.json.
  const LIST_PATH = '/opds/list';
  const LIST_PAGE_SIZE = 16;

  container.innerHTML =
    '<h2>Kopi</h2>' +
    '<p id="kopi-status">Checking configuration…</p>' +
    '<div class="setting-row"><span class="setting-name">Server URL</span>' +
    '<span class="setting-control"><input type="text" id="kopi-url" placeholder="https://kopi.example.com"></span></div>' +
    '<div class="setting-row"><span class="setting-name">Username</span>' +
    '<span class="setting-control"><input type="text" id="kopi-user" autocomplete="username"></span></div>' +
    '<div class="setting-row"><span class="setting-name">Password</span>' +
    '<span class="setting-control"><input type="password" id="kopi-pass" autocomplete="current-password"></span></div>' +
    '<div class="setting-row">' +
    '<button type="button" class="btn-small btn-add" id="kopi-save">Save</button> ' +
    '<button type="button" class="btn-small" id="kopi-test">Test</button> ' +
    '<button type="button" class="btn-small" id="kopi-clear" style="display:none">Clear</button>' +
    '</div>' +
    '<p style="color:#666">Enter your Kopi server address — the plugin adds the catalog path itself. ' +
    'Use the OPDS username and password from your Kopi account, not your login. ' +
    'Credentials are stored in plain text on the SD card, because the reader needs ' +
    'them to authenticate each download.</p>';

  const urlEl = document.getElementById('kopi-url');
  const userEl = document.getElementById('kopi-user');
  const passEl = document.getElementById('kopi-pass');
  const clearBtn = document.getElementById('kopi-clear');
  const status = (t) => { document.getElementById('kopi-status').textContent = t; };

  // btoa alone mangles non-Latin1 text; the config may hold either.
  function b64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  // Accept the origin, a trailing slash, or a pasted feed URL — device.json
  // always appends the catalog path itself.
  function normalizeUrl(raw) {
    let url = raw.trim().replace(/\s+/g, '');
    url = url.replace(/\/+$/, '');
    url = url.replace(/\/opds(\/catalog\.xml)?$/i, '');
    return url.replace(/\/+$/, '');
  }

  async function loadConfig() {
    try {
      const r = await fetch('/download?path=' + encodeURIComponent(CONFIG_PATH));
      if (!r.ok) return null;
      return JSON.parse(await r.text());
    } catch (e) {
      return null;
    }
  }

  function writeConfig(cfg) {
    return api.writeFile(CONFIG_PATH, b64(JSON.stringify(cfg)));
  }

  function currentConfig() {
    const url = normalizeUrl(urlEl.value);
    const user = userEl.value.trim();
    const pass = passEl.value;
    // Every one of these is required. Saving a half-filled config is the worst
    // outcome: the reader reports only "Failed to fetch feed", which says
    // nothing about which field was missing.
    if (!url) throw new Error('Server URL is required.');
    if (!user && !pass) throw new Error('Username and password are required.');
    if (!user) throw new Error('Username is required.');
    if (!pass) throw new Error('Password is required.');
    // {cfg.auth} is the base64 for the browse request's Authorization header;
    // {cfg.user}/{cfg.pass} feed the device's file download (Basic auth).
    return { url, user, pass, auth: btoa(user + ':' + pass) };
  }

  // Verifies the config against the live feed. Returns {ok, rejected, message}:
  // `rejected` distinguishes "the server said no" from "we could not ask",
  // because only the former should block a save.
  async function verify(cfg) {
    // Probe /opds/list, not the Atom feed: that is the exact request the
    // device's browse screen makes, so a server too old to answer it fails
    // here with a clear message instead of as an empty list on the reader.
    // Kopi records a download row for every EPUB fetch, so never probe the
    // acquisition links from here.
    const r = await api.relay('GET', cfg.url + LIST_PATH,
      { Authorization: 'Basic ' + cfg.auth, Accept: 'application/json' }, '');
    if (r.status === 401 || r.status === 403) {
      return { ok: false, rejected: true,
        message: 'Username or password is incorrect (HTTP ' + r.status + ').' };
    }
    if (r.status === 404) {
      return { ok: false, rejected: true,
        message: 'No Kopi catalog at ' + cfg.url + LIST_PATH + ' (HTTP 404). Check the '
          + 'server URL — and that the server is new enough to serve this plugin.' };
    }
    if (r.status >= 200 && r.status < 300) {
      let items = null;
      try {
        items = JSON.parse(r.body || '{}').items;
      } catch (e) {
        return { ok: false, rejected: true,
          message: 'The server answered, but not with a Kopi catalog. Check the server URL.' };
      }
      if (!Array.isArray(items)) {
        return { ok: false, rejected: true,
          message: 'The server answered, but not with a Kopi catalog. Check the server URL.' };
      }
      if (!items.length) return { ok: true, rejected: false, message: 'Credentials OK, but no issues yet.' };
      // The list is one page, so a full page means "at least this many".
      const more = items.length > LIST_PAGE_SIZE;
      const count = more ? LIST_PAGE_SIZE : items.length;
      return { ok: true, rejected: false,
        message: 'Credentials OK. Found ' + count + (more ? '+' : '')
          + ' issue' + (count === 1 ? '' : 's') + '.' };
    }
    return { ok: false, rejected: false,
      message: 'Could not reach the server (HTTP ' + (r.status || r.error) + ').' };
  }

  document.getElementById('kopi-save').onclick = async () => {
    let cfg;
    try {
      cfg = currentConfig();
    } catch (e) {
      status(e.message);
      return;
    }
    status('Checking credentials…');
    try {
      const result = await verify(cfg);
      // Wrong credentials are never worth saving — the reader would fail with a
      // message that points nowhere. An unreachable server is different: it may
      // just be offline, so save and say so.
      if (result.rejected) {
        status(result.message + ' Nothing was saved.');
        return;
      }
      await writeConfig(cfg);
      urlEl.value = cfg.url;
      clearBtn.style.display = '';
      status(result.ok
        ? 'Saved. ' + result.message + ' Browse from the device: Settings > System > Plugins > Kopi.'
        : 'Saved, but could not verify: ' + result.message);
    } catch (e) {
      status('Error: ' + e.message);
    }
  };

  document.getElementById('kopi-test').onclick = async () => {
    let cfg;
    try {
      cfg = currentConfig();
    } catch (e) {
      status(e.message);
      return;
    }
    status('Testing…');
    try {
      status((await verify(cfg)).message);
    } catch (e) {
      status('Error: ' + e.message);
    }
  };

  clearBtn.onclick = async () => {
    try {
      await writeConfig({});
      urlEl.value = userEl.value = passEl.value = '';
      clearBtn.style.display = 'none';
      status('Configuration cleared.');
    } catch (e) {
      status('Error: ' + e.message);
    }
  };

  const existing = await loadConfig();
  if (existing && existing.url) {
    urlEl.value = existing.url;
    userEl.value = existing.user || '';
    passEl.value = existing.pass || '';
    clearBtn.style.display = '';
    // A config saved without credentials (hand-edited, or written by an older
    // version) fails on the reader with an error that names no cause. Say so here.
    if (!existing.user || !existing.pass) {
      status('Username and password are missing — the reader cannot sign in. Fill them in and save.');
    } else {
      status('Configured. Browse from the device, or update below.');
    }
  } else {
    urlEl.value = DEFAULT_URL;
    status('Not configured yet. Enter your OPDS username and password.');
  }
});
