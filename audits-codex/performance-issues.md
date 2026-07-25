# Performance and Scalability Audit

## Findings

### PERF-01 — The authenticated canvas can load up to 100,000 items before failing

- **Severity:** High
- **Location:** Canvas item pagination in `useCanvasItems`; default non-viewport canvas load
- **Description:** Without a viewport filter the client follows as many as 100 pages, each allowing up to 1,000 items, and only then reports the safety limit. Virtual rendering reduces draw cost but not database reads, network transfer, parsing, cache memory, or client-side item processing.
- **Why it matters for production:** A large or malicious canvas can create multi-megabyte responses, long startup freezes, mobile crashes, and heavy repeated database work.
- **Recommended fix:** Make viewport/tile loading the default, request only item summaries for organizer/search views, enforce a lower server-side canvas budget, and stop with a deliberate partial-load UI before downloading the limit.
- **Blocker before production:** Yes for unbounded user-created canvases.
- **Related risks or dependencies:** Connections, selection, search, export, and frame membership need a defined partial-data contract.

### PERF-02 — Public share responses return the entire canvas without pagination

- **Severity:** High
- **Location:** `/api/v1/public/canvases/[token]`, `/share/[token]`
- **Description:** The public endpoint serializes every visible item in a single response rather than using viewport or cursor pagination.
- **Why it matters for production:** Anonymous requests can repeatedly force large database reads and response serialization, while viewers pay the full canvas cost before seeing content.
- **Recommended fix:** Return canvas metadata separately, paginate/tile items, cache immutable public metadata carefully, apply response-size limits, and rate-limit by trusted client identity and token.
- **Blocker before production:** Yes for public links to user-controlled canvases.
- **Related risks or dependencies:** Public alternate/list accessibility must work with partial data (`UI-03`).

### PERF-03 — Thumbnail generation stores large base64 blobs in the primary database

- **Severity:** High
- **Location:** Canvas thumbnail hook, stage `toDataURL`, `Canvas.thumbnail`
- **Description:** The client rasterizes the stage after item revisions and writes a base64 data URL (allowed to roughly 300 KB) into the Canvas record. Dashboard queries then transport these blobs with canvas metadata.
- **Why it matters for production:** Repeated rasterization blocks the browser, inflates database/WAL/backup size, dirties hot rows, and makes list queries and cache entries much larger.
- **Recommended fix:** Generate thumbnails asynchronously from a bounded representation, store a small WebP/AVIF object in object storage, retain only its key/revision in the database, debounce by meaningful revision, and serve responsive sizes through caching.
- **Blocker before production:** Yes if large canvas/dashboard usage is expected; otherwise impose a very small launch limit.
- **Related risks or dependencies:** Object cleanup and object-storage backup must first be reliable (`SEC-03`, `DEP-02`).

### PERF-04 — Asset upload and download paths buffer whole files in application memory

- **Severity:** High
- **Location:** Upload and authorized asset routes
- **Description:** Inbound form data becomes an `ArrayBuffer`; outbound S3 objects become a complete byte array before the response. Concurrent requests multiply the configured file limit by active request count.
- **Why it matters for production:** Moderate concurrency can cause high garbage-collection pressure or out-of-memory restarts, particularly in a container with no explicit resource budget.
- **Recommended fix:** Stream both directions, enforce bytes while streaming, support range requests, bound concurrency, and move scanning/metadata extraction into a worker with explicit memory limits.
- **Blocker before production:** Yes for public uploads or medium-sized production files.
- **Related risks or dependencies:** Same remediation boundary as `SEC-08`.

### PERF-05 — Version history copies complete canvas state without retention limits

- **Severity:** High
- **Location:** Canvas version creation/restoration and `CanvasVersion` storage
- **Description:** Each version serializes the full item set. No documented count, age, or aggregate-byte retention policy bounds history growth; restore replays items sequentially in a transaction.
- **Why it matters for production:** Storage grows as canvas size multiplied by version count, backups expand, and restore transactions become slow and contention-prone.
- **Recommended fix:** Add per-canvas retention and byte quotas, compact unchanged history or use revision deltas plus periodic checkpoints, build versions in a worker, and restore through a bounded set-based operation with conflict protection.
- **Blocker before production:** Yes if automatic or frequent version creation is enabled; otherwise limit the feature before launch.
- **Related risks or dependencies:** Restore correctness is also covered by `LOG-10`; version-diff UX is a future enhancement.

### PERF-06 — Viewport changes generate durable writes and activity noise

- **Severity:** Medium
- **Location:** Canvas pan/zoom persistence and Canvas PATCH/activity logging
- **Description:** Pan and zoom are persisted to the Canvas row after a short debounce. This updates `updatedAt`, invalidates caches, changes dashboard ordering, and can generate generic canvas-update activity for personal navigation state.
- **Why it matters for production:** Normal browsing creates write amplification, hot-row contention, misleading recency, and noisy activity/analytics.
- **Recommended fix:** Keep viewport per user/device in local storage or a dedicated preference record. Do not update content recency/activity for camera movement; persist less often and only if cross-device restoration is a product requirement.
- **Blocker before production:** No, but fix before meaningful activity feeds or high collaboration concurrency.
- **Related risks or dependencies:** Decide whether camera is shared presentation state or personal preference.

### PERF-07 — The bundle budget script is a false-positive release check

- **Severity:** Medium
- **Location:** Bundle-analysis/check script and Next.js App Router build output
- **Description:** The checker looks for page-style chunk names while the application uses the App Router. In the audited build all 182 JavaScript chunks (about 1.63 MB aggregate gzip) were classified as `OTHER`, so landing/auth/canvas budgets were never applied even though the script passed.
- **Why it matters for production:** Client bundle regressions receive a green CI signal, and expensive canvas/editor dependencies can leak into unrelated routes unnoticed.
- **Recommended fix:** Read Next build manifests for App Router route-to-chunk mappings, measure route entrypoints and shared chunks separately, fail if no expected routes are classified, and record budgets as CI artifacts.
- **Blocker before production:** No, but the existing check must not be treated as performance evidence.
- **Related risks or dependencies:** The largest observed raw chunk was about 793 KB; verify source maps and dynamic imports before setting final budgets.

### PERF-08 — Large modules concentrate rendering and mutation work

- **Severity:** Medium
- **Location:** `CanvasBoard.tsx`, agent service core, collaboration and item hook modules
- **Description:** Several central modules exceed roughly one thousand lines and coordinate fetching, interaction state, shortcuts, mutations, overlays, presence, and dialogs. Broad state dependencies make targeted memoization and regression analysis difficult.
- **Why it matters for production:** Small state changes can fan out through large component trees, while maintenance changes have an unusually large performance and correctness blast radius.
- **Recommended fix:** After launch blockers are fixed, profile with React tools, extract capability/state controllers and item-type adapters, isolate subscriptions, and add render-count/load benchmarks before refactoring.
- **Blocker before production:** No.
- **Related risks or dependencies:** Refactoring before data-integrity fixes risks preserving incorrect contracts; sequence this after `LOG-01` through `LOG-06`.

### PERF-09 — Multi-instance collaboration has partial fanout and stale presence risk

- **Severity:** High
- **Location:** WebSocket server, Redis pub/sub presence/cursor integration
- **Description:** Redis distributes some presence/cursor information, while chat/reactions remain local-instance. Remote presence/cursor state has no robust lease/TTL cleanup for a crashed instance.
- **Why it matters for production:** Horizontally scaled users observe different conversations and can see ghost collaborators. A load balancer changes behavior based on which instance a client reaches.
- **Recommended fix:** Define one cross-instance event bus contract, attach monotonic event IDs and expiring presence leases, publish all supported transient events, and exercise instance loss/reconnect in load tests.
- **Blocker before production:** Yes for multi-replica deployment; constrain launch to one instance otherwise.
- **Related risks or dependencies:** Item mutation synchronization remains absent (`LOG-01`) and must join the same architecture.

## Performance priorities before production

1. Bound authenticated and public canvas reads by viewport, page, and aggregate bytes.
2. Stream and quarantine assets rather than buffering them in the web process.
3. Move thumbnails out of hot database rows and cap version-history growth.
4. Define a single-instance launch constraint or complete multi-instance event fanout and leases.
5. Repair bundle budgets and add representative large-canvas/load tests.
