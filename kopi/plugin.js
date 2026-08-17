// Kopi setup for CrossPoint. Collects the Kopi server URL and OPDS credentials
// in the browser and writes them to /.crosspoint/kopi.json, which the on-device
// Kopi screen (device.json) reads to browse the OPDS feed and download issues.
// Browsing and downloading then happen on the reader under Settings > System >
// Plugins > Kopi — no computer needed after setup.
CrossPoint.registerPlugin(async (container, api) => {
  const CONFIG_PATH = '/.crosspoint/kopi.json';

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
    '<p style="color:#666">Enter your Kopi server address — the plugin adds /opds itself. ' +
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
  // always appends /opds itself.
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
    const user = userEl.value;
    const pass = passEl.value;
    if (!url) throw new Error('server URL is required');
    // {cfg.auth} is the base64 for the browse request's Authorization header;
    // {cfg.user}/{cfg.pass} feed the device's file download (Basic auth).
    return { url, user, pass, auth: btoa(user + ':' + pass) };
  }

  document.getElementById('kopi-save').onclick = async () => {
    try {
      const cfg = currentConfig();
      await writeConfig(cfg);
      urlEl.value = cfg.url;
      clearBtn.style.display = '';
      status('Saved. Browse from the device: Settings > System > Plugins > Kopi.');
    } catch (e) {
      status('Error: ' + e.message);
    }
  };

  document.getElementById('kopi-test').onclick = async () => {
    let cfg;
    try {
      cfg = currentConfig();
    } catch (e) {
      status('Error: ' + e.message);
      return;
    }
    status('Testing…');
    try {
      // One plain GET of the feed. Kopi records a download row for every EPUB
      // fetch, so never probe the acquisition links from here.
      const r = await api.relay('GET', cfg.url + '/opds',
        { Authorization: 'Basic ' + cfg.auth, Accept: 'application/atom+xml' }, '');
      if (r.status === 401 || r.status === 403) {
        status('Authentication failed (HTTP ' + r.status + '). Check the username and password.');
      } else if (r.status >= 200 && r.status < 300) {
        const body = r.body || '';
        const found = body.match(/<entry\b/g);
        const count = found ? found.length : 0;
        // The relay truncates response bodies at 32 KB, so a large feed may
        // report fewer entries than the server actually returned.
        status(count
          ? 'Connection OK. Found ' + count + ' issue' + (count === 1 ? '' : 's') + '.'
          : 'Connection OK, but the feed is empty.');
      } else {
        status('Server returned HTTP ' + (r.status || r.error) + '.');
      }
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
    status('Configured. Browse from the device, or update below.');
  } else {
    status('Not configured yet.');
  }
});
