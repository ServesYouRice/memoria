# Share links from your phone

Send a link from any app on your phone to your Memoria **Inbox**. You
can add a short "How should this be sorted?" note that the Inbox sorter reads
later.

- **Android:** install Memoria as an app, then use the system Share menu.
- **iPhone and iPad:** iOS does not let installed web apps appear in the Share
  menu, so use the Apple Shortcut below.

## Android

1. Open Memoria in Chrome (or another browser that installs web apps) and
   choose **Install app** / **Add to Home screen**.
2. In any app, tap **Share** and pick **Memoria**.
3. Memoria saves the link to your Inbox and shows **Saved**. Type a note under
   "How should this be sorted?" and tap **Save note**, or just close the app.

If you are signed out, Memoria asks you to sign in first and then finishes the
save with the same link. Reloading the **Saved** page does not save the link a
second time. Shares that carry text with a link inside it (for example
"Look at this https://…") are saved by that link; text without a link is not
saved.

## iPhone and iPad (Apple Shortcut)

A Shortcut in the Apple **Shortcuts** app sends the shared link to your
Inbox. Setting it up takes a couple of minutes.

### 1. Create an API key

In Memoria, open **API Keys** and tap **Create a key for my iPhone**. Copy
the server address and the key it shows; the key is shown only once. The key
can save to your account, so keep the Shortcut on your own devices only.

### Ready-made Shortcut

Some installations offer a ready-made Shortcut. Then the **Save from your
phone** section of Memoria's Help shows an **Add the Shortcut** button: tap
it, paste the server address and the key when it asks, and skip step 2.

### 2. Build the Shortcut

Open the **Shortcuts** app, tap **+**, and name the Shortcut "Save to
Memoria". Then add these actions in order:

1. Open the Shortcut's details (the **ⓘ** button) and turn on **Show in Share
   Sheet**. Under **Share Sheet Types** keep only **URLs**, **Safari web
   pages** and **Text**.
2. **Get URLs from Input** — input: *Shortcut Input*.
3. **Get Item from List** — *First Item* from *URLs*.
4. **Format Date** — date: *Current Date*, format: *Custom*,
   `yyyyMMddHHmmssSSS`.
5. Optional: **Ask for Input** — type *Text*, prompt
   "How should this be sorted?". Leave the answer empty to skip the note.
6. **Get Contents of URL**:
   - URL: `https://<your-memoria-address>/api/v1/extensions/clip/batch`
   - Method: **POST**
   - Headers: `x-api-key` = your API key
   - Request Body: **JSON**, with these fields:
     - `idempotencyKey` (Text): `ios-` followed by the *Formatted Date*
       variable
     - `links` (Array) with one item of type Dictionary:
       - `url` (Text): the *Item from List* variable
     - `note` (Text): the *Provided Input* variable (leave this field out if
       you skipped step 5)
7. **Show Notification** — "Saved to Memoria".

### 3. Use it

In Safari or any app, tap **Share** and pick **Save to Memoria**. The link
lands on your Inbox.

### Troubleshooting

| Response | Meaning |
| --- | --- |
| `401` | The API key is wrong or was revoked. Create a new one. |
| `400` | The link is not `http://` or `https://`, or the body is malformed. Check the field names and types in step 6. |
| `409` | The idempotency key was reused for a different link. Check the *Formatted Date* step. |
| `422` | The Inbox is full. Sort or clear it first. |
| `429` | Too many saves in a short time. Wait a minute. |

## For developers: the request the Shortcut sends

The Shortcut sends the shared link to the same endpoint the browser extension
uses:

```
POST https://<your-memoria-address>/api/v1/extensions/clip/batch
x-api-key: <your API key>
Content-Type: application/json

{
  "idempotencyKey": "ios-20261105143012345",
  "links": [{ "url": "https://example.com/article" }],
  "note": "optional: how should this be sorted?"
}
```

`idempotencyKey` must be 8–128 letters, digits, `-` or `_`, and new for every
share. A repeated request with the same key and body returns the first save
(status 200) instead of creating the link again.
