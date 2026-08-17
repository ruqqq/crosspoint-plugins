# Libby

Read a library book you have borrowed in [Libby](https://libbyapp.com) on the
reader, without a computer in the middle.

Previously this needed a desktop app to turn a loan into a file the reader could
open. This plugin does that step itself: it lists your loans, fetches the
authorization file, and unlocks the book for this device.

Not affiliated with or endorsed by Libby, OverDrive, Adobe, or ByteBooks.

## Before you start

Everything below happens on the device web page, and it needs internet access:
start **File Transfer** in **Join Network** mode (not Hotspot) so the reader is
online.

You also need a content account — sign up at
[DTS ByteBooks](https://dtsbytebooks.com/register) if you don't have one. This is
what authorizes *this* device to open protected books, and it is separate from
your library card.

## Set up (once)

1. Open the device web page → **File Manager** → the **Libby** card.
2. Enter your content account **email** and **password**, tap **Activate
   device**. This saves a credential to the SD card. You only do this once.
3. Tap **Link Libby**. The card shows an 8-digit code.
4. In the Libby app: **menu → Copy To Another Device**, and enter that code.
   The card picks it up within a minute and lists your library.

## Borrow a book

1. Borrow the title in Libby as usual.
2. On the Libby card, tap **Refresh loans** and pick the title.
3. Tap **Send to device**. It lands in `/Libby/` and is ready to open.

## Notes

- Only borrowed **ebooks** appear. Audiobooks and magazines are not supported,
  and titles that Libby only offers in its own web reader can't be sent to a
  device by any app.
- The book stays protected on the SD card. It's unlocked in memory only while
  you're reading it here, and it stops opening when the loan ends — returning or
  deleting it is up to you.
- Most books arrive protected. A few titles are offered DRM-free by their
  publisher; those download directly and have no expiry beyond the loan.
- Your Libby link and your account credential are both stored on the SD card,
  so keep the card somewhere safe.

## If Libby stops responding

Libby has no public API, so this can break when they change things. The card
falls back to the manual route: in Libby choose **Read With… → Other Options →
EPUB** to download an `.acsm`, upload it with the File Manager, and use
**Fetch selected book** at the bottom of the card.

## Unlink

Tap **Unlink** on the card, or delete `/.crosspoint/libby.json`. That leaves the
content account alone; to remove that too, delete `/.crosspoint/content.key`.
