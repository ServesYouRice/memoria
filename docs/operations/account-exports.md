# Account exports

Account exports are built by the outbox worker and stored as a private,
checksummed `gzip` JSON Lines object. `POST /api/v1/users/account/exports`
returns a durable export id immediately; the status and download endpoints
never expose storage keys or storage routing details.

## Format

The current format version is `2`. Every line is an object with a
`recordType` and `value`. The first line is a `manifest`; the final line is a
`manifestEnd`. The completed export status includes the SHA-256 digest of the
complete compressed archive, and the download response repeats it in
`X-Content-SHA256` and the `Digest` header.

The manifest declares the scopes and exclusions below. Records are emitted in
stable id order and paged in batches of 100 so cancellation can be observed
between pages.

Included record types:

- `profile`
- `workspace`, `canvas`, `canvasItem`, and `canvasVersion`
- `canvasShare`, `comment`, `activity`, and `notificationPreference`
- `uploadMetadata`
- `uploadObjectStart`, ordered `uploadObjectChunk` records, and
  `uploadObjectEnd` for active private upload objects owned by the account

Password/session material, OAuth/API credentials, verification/invitation
secrets, model/integration credentials, operational logs, and derived
thumbnails are excluded. Upload chunks are base64-encoded JSON values and have
an independent byte count and SHA-256 digest in their end record.

## Budgets and lifecycle

The default input budget is 384 MiB uncompressed and the default compressed
archive budget is 256 MiB. `ACCOUNT_EXPORT_MAX_INPUT_BYTES` and
`ACCOUNT_EXPORT_MAX_ARCHIVE_BYTES` may lower or raise those limits for an
operator profile; invalid values fall back to the documented defaults. The
worker fails closed when either meter is exceeded, cleans up partial private
objects, and records a terminal failed export rather than silently truncating
the archive.

Exports are retained for 24 hours after completion. Cancellation is checked
between pages and upload chunks; a cancellation request marks the export
cancelled and schedules deletion of any already-written object. A durable
delete job also removes expired output. See
[resource-budgets.md](resource-budgets.md) for the complete launch-scale
budget table and [observability.md](observability.md) for operational alerts.
