# Kopi

Read your Kopi briefings on the reader. Kopi
publishes each issue as an EPUB and serves them over an OPDS feed; this plugin
lists that feed on the device and downloads issues to the SD card.

## Set up (once, from a browser)

1. In Kopi, create an OPDS credential and note the username and password.
2. Open the device web page → **Settings** → the Kopi card.
3. The **Server URL** is prefilled. Change it if you run your own instance —
   pasting the full feed URL (`.../opds`) works too, the plugin trims it.
4. Enter the OPDS username and password and tap **Save**.

Save verifies the credentials against the feed before writing anything. If the
server rejects them, nothing is saved and the card says which field is wrong —
rather than leaving the reader to fail later with "Failed to fetch feed", which
names no cause. If the server can't be reached at all, the config is still
saved with a warning, since an offline server shouldn't block setup. **Test**
runs the same check without saving.

The username is case-sensitive on older Kopi deployments, so enter it exactly
as issued.

## Use

1. On the reader, go to **Settings → System → Plugins → Kopi**.
2. Your published issues are listed newest first.
3. Press Confirm on an issue to download it to `/Kopi/` on the SD card, then
   open it from the library as usual.

## Notes

- Only the newest 16 issues are listed. The reader's catalog screen reads one
  page at a time and Kopi's feed does not paginate yet.
- Download only — nothing is uploaded and reading progress is not synced back.
- Downloading the same issue twice fetches it again and counts as a second
  download in Kopi's stats.
- Your OPDS password is stored in plain text on the SD card, because the reader
  needs it to authenticate each download. Keep the card somewhere safe.

## Clear

Tap **Clear** on the web card, or delete `/.crosspoint/kopi.json`.
