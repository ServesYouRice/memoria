# Memoria browser button

A Manifest V3 extension for Chrome, Edge and Firefox (128+). One click saves
the page you are on to Memoria; a second view saves every open tab.

- **Save this page** (the popup's first view): saves the current page, with
  any text you selected on it, to the canvas you pick. The picker remembers
  your last choice and starts on the Inbox.
- **Right-click → Save to Memoria** on a page, a link or a selection, and the
  keyboard shortcut **Alt+Shift+S**, save to the last chosen canvas. The
  toolbar button shows ✓ (saved), = (already saved) or ! (failed); open the
  popup to see the result and open the saved link.
- A link you already saved is not saved again; Memoria tells you where it is
  and the popup offers **Open it**.
- **Save all tabs in this window**: ticks the normal web tabs (not pinned tabs
  or browser pages), stores the optional "How should these be sorted?" note,
  and closes tabs only after Memoria confirms them. A retry reuses the same
  idempotency key, so a batch is never saved twice.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab`, `scripting` | Read the selected text of the current tab, only when you click save or press the shortcut |
| `contextMenus` | The right-click "Save to Memoria" entry |
| `tabs` | List and close tabs for "Save all tabs" |
| `storage` | Your Memoria address, API key and last chosen canvas |
| Your Memoria address (asked at setup) | Send saves to your Memoria, nothing else |

No page is read until you save it.

## Install (for yourself)

1. In Memoria, open **API Keys** and create a key.
2. Load this folder as an unpacked extension:
   - Chrome / Edge: `chrome://extensions` (or `edge://extensions`), turn on
     Developer mode, **Load unpacked**, pick this folder.
   - Firefox: `about:debugging#/runtime/this-firefox`, **Load Temporary
     Add-on…**, pick `manifest.json`.
3. Open the extension, paste your Memoria address and the key, and allow access
   to that address when the browser asks.
4. To change the shortcut: `chrome://extensions/shortcuts`, or in Firefox
   **Add-ons → ⚙ → Manage Extension Shortcuts**.

## Build store packages

```bash
pnpm extension:build
```

This writes `dist/browser-extension/memoria-chrome-<version>.zip` (Chrome Web
Store and Edge Add-ons) and `memoria-firefox-<version>.zip`
(addons.mozilla.org). Each has a manifest with only the keys that browser
reads. Raise `version` in `manifest.json` before each upload.

## Publish

Publishing needs the owner's store accounts.

- **Chrome Web Store**: in the [developer dashboard](https://chrome.google.com/webstore/devconsole)
  add a new item, upload the Chrome zip, fill in the listing (description,
  128×128 icon, at least one 1280×800 screenshot, a privacy policy link such
  as `<your Memoria address>/privacy`), and explain each permission with the
  table above.
- **Edge Add-ons**: in [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge)
  upload the same Chrome zip.
- **Firefox**: on [addons.mozilla.org](https://addons.mozilla.org/developers/)
  submit the Firefox zip. The add-on id is `tab-saver@memoria.app`; keep it so
  updates reach existing installs. The source is not minified, so no separate
  source upload is needed.

## API

The extension sends the key in the `x-api-key` header to:

- `POST /api/v1/extensions/clip`: save one page (`url`, `title`, `selection`,
  `canvasId`).
- `GET /api/v1/extensions/canvases`: names and ids of your canvases, for the
  picker.
- `POST /api/v1/extensions/clip/batch`: save many tabs at once.
