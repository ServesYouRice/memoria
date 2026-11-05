# Memoria Tab Saver

A Manifest V3 extension for Chrome, Edge and Firefox (128+) that saves the tabs
in the current window to your Memoria Inbox and then closes them.

- Normal web tabs are ticked when the popup opens; pinned tabs and browser
  pages (`chrome://`, `about:`, extension pages) are not.
- The optional "How should these be sorted?" note is stored with the batch.
- Tabs close only after Memoria confirms the save. A retry reuses the same
  idempotency key, so a batch is never saved twice.
- A tab whose link is already in your boards is not saved again; the popup
  lists it with a button that opens the existing copy.

## Install

1. In Memoria, open **API Keys** and create a key.
2. Load this folder as an unpacked extension:
   - Chrome / Edge: `chrome://extensions` (or `edge://extensions`), turn on
     Developer mode, **Load unpacked**.
   - Firefox: `about:debugging#/runtime/this-firefox`, **Load Temporary
     Add-on…**, pick `manifest.json`.
3. Open the extension, paste your Memoria address and the key, and allow access
   to that address when the browser asks. Both are kept in `storage.local`.

The extension calls `POST /api/v1/extensions/clip/batch` with the key in the
`x-api-key` header.
