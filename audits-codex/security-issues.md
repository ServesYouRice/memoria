# Security Issues

Audit date: 2026-08-08. Severity reflects a public or multi-user self-hosted production deployment. “Blocker” means the issue should be resolved or explicitly mitigated before production traffic is accepted.

## SEC-01 — Fresh self-host installs retain repository-known operational and backup secrets

- **Severity:** Critical
- **Location:** `.env.example:21,76,80`; `scripts/setup.mjs:55-104`; `src/lib/env.ts:122-135`; `src/lib/operations/internal-auth.ts`; `src/app/api/operations/outbox/route.ts:25-69`; `scripts/backup-database.sh:451-452`
- **Description:** `setup:selfhost` copies `.env.example` and rotates the database, Auth.js, bootstrap, Redis, MinIO, model-credential, and cron secrets. It does not rotate `INTERNAL_OPERATIONS_TOKEN`, `BACKUP_MANIFEST_HMAC_KEY`, or the recovery-profile MinIO credentials. The example operations token is long enough to satisfy the production validator, and the backup scripts check only that the HMAC key is non-empty. The operations token authorizes protected readiness/metrics reads and mutation of outbox jobs, including replay and cancellation.
- **Production impact:** Anyone who knows the public repository defaults and can reach the deployment can inspect operational state and cancel or replay queued email, upload-deletion, and maintenance work. A known HMAC key also defeats the authenticity guarantee of backup manifests. These are predictable credentials, not merely weak examples.
- **Recommended fix:** Generate all production secrets independently during setup; reject known placeholder patterns in both runtime validation and `doctor`; write backup credentials only when the recovery profile is explicitly configured; rotate any installations created with the current flow. Add a clean-install test that asserts every security-sensitive value differs from the template and that the template token cannot access operations routes.
- **Production blocker:** Yes.
- **Related risks/dependencies:** `DEP-01`, `DEP-02`, `TEST-06`. Existing installations need an explicit rotation runbook because rotating the backup HMAC key affects which manifests can be verified.

## SEC-02 — DNS rebinding can bypass the SSRF checks

- **Severity:** High
- **Location:** `src/lib/utils/ssrf-protection.ts:115-145,200-251`; `src/lib/agents/webhooks.ts:117-165`; `tests/unit/ssrf-hostile.test.ts`
- **Description:** Both URL unfurling and outbound webhooks resolve and validate a hostname, then call `fetch()` with the hostname. The HTTP client performs its own later DNS resolution, so an attacker can return a public address during validation and a private, loopback, link-local, or cloud-metadata address during connection. Redirect targets are checked, but each hop retains the same time-of-check/time-of-use gap.
- **Production impact:** An authenticated attacker or approved integration could make the server connect to internal services or metadata endpoints that the validation layer claimed to block. Unfurling is enabled by default in the example configuration, and signed webhooks use the same primitive.
- **Recommended fix:** Resolve once and pin the actual socket connection to a vetted address through a custom Undici dispatcher/lookup hook. Preserve the original Host/SNI, validate the connected address, repeat the process for every redirect, and reject mixed public/private DNS answer sets. Add deterministic DNS-rebinding tests for IPv4, IPv6, mapped IPv6, redirects, and address changes between lookup attempts.
- **Production blocker:** Yes while either external fetch surface is enabled.
- **Related risks/dependencies:** `LOG-05`, `TEST-06`. The current hostile tests cover alternate IP forms and redirect revalidation but not connection pinning.

## SEC-03 — Durable HTTP writes and uploads do not have enforceable payload-size limits

- **Severity:** High
- **Location:** `src/app/api/v1/canvas-items/route.ts:44-47`; `src/app/api/v1/canvas-items/[itemId]/route.ts:75-78`; `src/lib/validation/canvas-item.ts:75-76,117,157,188`; `src/app/api/v1/upload/route.ts:300-355`; `src/proxy.ts:104-116`
- **Description:** Route handlers buffer `request.json()` or `request.formData()` before application validation. Several item schemas leave strings and arrays unbounded, including bookmark metadata, drawing points, and text content. The upload route checks a 5 MiB `File.size` only after multipart parsing and then copies the file again through `arrayBuffer()`/`Buffer`. Rate limiting controls request count, not bytes, and no supported ingress layer enforces a body cap.
- **Production impact:** One authenticated request can consume excessive process memory, event-loop time, database storage, snapshot storage, response bandwidth, and client rendering resources. An oversized multipart body can pressure memory before the nominal file-size check runs.
- **Recommended fix:** Set an ingress-level hard body limit, reject implausible `Content-Length` before parsing, use bounded streaming multipart handling, and enforce serialized-byte plus structural limits for every item type. Add per-user durable-content quotas in addition to item counts. Return 413 for body limits and a typed 422/400 for item-shape limits.
- **Production blocker:** Yes for public registration or untrusted users.
- **Related risks/dependencies:** `LOG-01`, `PERF-01`, `PERF-02`, `DEP-01`. Do not rely on `Content-Length` alone because clients can omit or falsify it.

## SEC-04 — The production dependency audit is red

- **Severity:** High
- **Location:** `package.json`; `pnpm-lock.yaml`; `.github/workflows/ci.yml:177`
- **Description:** `pnpm audit --prod --audit-level=high` reported 10 production-tree advisories: 5 high and 5 moderate. Confirmed vulnerable resolved versions include `sharp@0.34.5` (libvips image-processing advisories; patched in `>=0.35.0`), `undici@7.28.0` (information-disclosure/crash advisories; patched in `>=7.29.0`), `fast-uri@3.1.3` (patched in `>=3.1.5` for the newest advisory), and `nanoid@3.3.16` (patched in `>=3.3.17`). `sharp` is pulled by Next.js, `undici` by Cheerio, `fast-uri` by Ajv, and `nanoid` by PostCSS.
- **Production impact:** The release dependency gate fails. Some paths may be build-only or not invoke the vulnerable feature, but reachability has not been documented and the image-processing dependency is directly adjacent to an upload-heavy product.
- **Recommended fix:** Update direct parents/lockfile until the production audit is clean, rerun unit/integration/E2E/build checks, and document any advisory that remains with exact runtime reachability and a time-bounded exception. Generate an SBOM and scan the built image as well as the package tree.
- **Production blocker:** Yes until upgraded or formally triaged.
- **Related risks/dependencies:** `TEST-02`. Advisory references emitted by the package manager included `GHSA-f88m-g3jw-g9cj`, `GHSA-4cwx-7wf7-3272`, `GHSA-7p8r-x3mc-p8w7`, and `GHSA-2v37-7h3g-55p8`.

## SEC-05 — Raster uploads lack decoded-dimension and normalization controls

- **Severity:** Medium
- **Location:** `src/app/api/v1/upload/route.ts:30-36,78-116,221-291,333-355`; `docker-compose.yml:39-40`
- **Description:** Uploads are capped by compressed file size and checked by magic bytes, but image dimensions, decoded pixel count, animation frame count, and decompression cost are not bounded. Files are stored without a trusted re-encode. Malware scanning is optional and defaults off in the reference stack.
- **Production impact:** A small compressed image or polyglot can impose disproportionate decode/memory cost on the app, browser, thumbnail worker, or downstream scanner. Public canvases can make that cost reach anonymous viewers.
- **Recommended fix:** Parse image metadata in a sandboxed/bounded worker, reject excessive dimensions/pixels/frames, strip metadata, and re-encode to a small approved format set. Make scan/re-encode policy explicit for public deployments and test hostile/corrupt inputs.
- **Production blocker:** No if registration is restricted and an ingress cap is in place; otherwise treat it as part of `SEC-03`.
- **Related risks/dependencies:** `PERF-02`, `DEP-01`.

## SEC-06 — Client error boundaries can disclose raw exception messages

- **Severity:** Low
- **Location:** `src/features/canvas/components/CanvasErrorBoundary.tsx`; `src/components/ErrorBoundary.tsx`
- **Description:** Generic API errors are sanitized in production, but client error boundaries render `error.message`. Messages raised by third-party libraries or future code can contain implementation details or values that were not written for end users.
- **Production impact:** A rendering failure may disclose internal state and produces inconsistent, technical recovery copy.
- **Recommended fix:** Show a stable incident message and request ID to the user, send the original exception only to telemetry, and allow a small explicit set of safe domain messages.
- **Production blocker:** No.
- **Related risks/dependencies:** `DEP-06`.

## Security release order

1. Rotate and reject all known setup secrets (`SEC-01`).
2. Pin validated DNS addresses for every server-side external connection (`SEC-02`).
3. Enforce ingress and domain payload limits (`SEC-03`).
4. Clear or explicitly accept the production dependency advisories (`SEC-04`).
5. Harden uploaded-image processing and client error disclosure (`SEC-05`, `SEC-06`).
