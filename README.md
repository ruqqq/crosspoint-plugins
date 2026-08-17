# CrossPoint plugins

A [CrossPoint](https://github.com/itsthisjustin/sd-plugins) plugin store — a
`catalog.json` plus the plugin folders it lists. The reader's Plugin Store can
load any number of catalogs, so adding this one sits alongside the official
store rather than replacing it.

## Add this store to your reader

You need the Plugin Store plugin installed first. If it isn't, download
[`plugin-store.zip`](https://github.com/itsthisjustin/sd-plugins/releases/download/plugin-store/plugin-store.zip)
and unzip it at the root of your SD card.

Then, in the device web UI:

1. Open **Settings** → the **Plugin Store** card.
2. Paste this URL into the "Add store" box and tap **Add store**:

   ```
   https://raw.githubusercontent.com/ruqqq/crosspoint-plugins/main/catalog.json
   ```
3. Tap **Save & refresh**. The plugins below appear under *ruqqq's Plugins*.
4. Tap **Install** on the one you want, then reconnect or reopen Settings.

Note: catalogs added this way are used by the **web UI** store only. The
on-device store screen (Settings → System → Plugins → Plugin Store) reads a
catalog URL baked into its own `device.json`, so it will keep showing the
official catalog.

## Plugins

- **[kopi](kopi/)** — read your Kopi briefings on the reader. Kopi serves each
  issue as an EPUB over an OPDS feed; the plugin lists the feed on the device
  and downloads issues to `/Kopi/` on the SD card. Set the server URL and OPDS
  credentials once from the web UI, then use it entirely on the reader.

## Install by hand instead

Copy a plugin folder to the SD card under `/plugins/<name>/` (or
`/.crosspoint/plugins/<name>/`) and reconnect to the web UI.

## Development

```sh
npm test
```

Zero dependencies — the built-in `node:test` runner only.

Every plugin folder holds `manifest.json` (title + mount point), an optional
`device.json` (a declarative on-device screen the firmware interprets), the
browser `plugin.js`, and a user-facing `README.md`. The contract is documented
in the [upstream repo](https://github.com/itsthisjustin/sd-plugins) — see its
`README.md` and `.claude/skills/create-plugin/reference.md`.

When changing a plugin, bump `version` in **both** its `manifest.json` and this
repo's `catalog.json`. The store compares the installed manifest's version
against the catalog to decide whether to offer an update, so a mismatch between
those two files makes a plugin claim an update forever.
