# Nice-to-Haves and Practical Future Work

These items are intentionally secondary to the blockers in the other audit files. They should not displace correctness, security, recovery, or release-gate work.

## High-impact additions

### NTH-HI-01 — Portable archive export and import

- **Value:** Turns the current incomplete JSON download into a credible ownership/migration feature for self-hosters.
- **Location/dependency:** Build after `PERF-01`; use a versioned manifest with paged records, checksummed binary assets, export expiration, dry-run import, and conflict handling.
- **Risk to manage:** Secrets, password hashes, live invitation tokens, and provider credentials must never enter the archive.

### NTH-HI-02 — Operator launch and recovery console

- **Value:** A small authenticated console could summarize readiness, migration state, outbox backlog, backup freshness, last restore drill, version, and support bundle generation without requiring shell fluency.
- **Location/dependency:** Build only after `SEC-01` and ingress isolation; keep destructive actions step-up authenticated and audited.
- **Risk to manage:** Do not turn protected operational data into a public status surface.

### NTH-HI-03 — Canvas-scale diagnostics for owners

- **Value:** Show item count/bytes, image usage, version usage, and the configured launch limits before a canvas becomes slow or cannot be snapshotted.
- **Location/dependency:** Reuse `/api/v1/usage` and the byte quotas introduced for `SEC-03`/`PERF-02`.
- **Risk to manage:** Counts must come from server authority, not only loaded client pages.

## Product polish

### NTH-PP-01 — Minimap and “return to content” recovery

- **Value:** Large infinite canvases benefit from a minimap, visible viewport bounds, and one action to return to the nearest/all content after an accidental pan.
- **Dependency:** Implement after viewport loading/culling so the minimap consumes lightweight geometry rather than full item payloads.

### NTH-PP-02 — Human-readable version summaries

- **Value:** Version history can show “12 items changed by A and B,” share/public-link events, and restore consequences instead of only timestamps.
- **Dependency:** Derive summaries from committed events; do not store another unbounded snapshot copy.

### NTH-PP-03 — Share-recipient onboarding

- **Value:** After notifications are fixed, guide invited users from notification/email to accept/decline, explain their role, and open the exact canvas with a clear revoked/expired state.
- **Dependency:** `LOG-03` and the production email gate.

## Developer experience

### NTH-DX-01 — Generate configuration artifacts from one schema

- **Value:** Generate `.env.example`, Compose pass-through, setup prompts, doctor checks, and operator documentation from one typed registry. This directly prevents the drift in `DEP-01` and `SEC-01`.
- **Dependency:** Each key needs metadata for scope (build/runtime/worker), secret status, default, validation, and supported services.

### NTH-DX-02 — Shared runtime API contracts

- **Value:** Export Zod schemas and inferred types for route responses and clients so status/share/notification drift fails at build/test time.
- **Dependency:** Start with bounded item pages, public share, health/readiness, and notifications (`TEST-03`).

### NTH-DX-03 — Component scenarios for risky states

- **Value:** Add deterministic stories/tests for empty/loading/error/disabled/overflow/dark/light states of ShareDialog, status, notification inbox, canvas chrome, and item accessibility.
- **Dependency:** Can use existing Vitest/Playwright tooling; a large new design-system dependency is not required.

## Architecture recommendations

### NTH-AR-01 — Cursor/byte-budget pagination as a platform primitive

- **Value:** One tested encoder/cursor contract can serve authenticated canvases, public shares, exports, notifications, activity, and future integrations without offset/truncation ambiguity.
- **Dependency:** Treat this as the durable fix for `LOG-01`, then reuse it rather than adding route-specific loops.

### NTH-AR-02 — Explicit background-job execution contract

- **Value:** Standardize deadline, lease renewal, idempotency, retry class, dedupe key, metrics, and cancellation for email, upload deletion, thumbnails, retention, and webhooks.
- **Dependency:** Keep PostgreSQL outbox as durable authority; no new broker is necessary at current scale.

### NTH-AR-03 — Capability registry for release-gated features

- **Value:** A server-owned capability document consumed by UI, API, help copy, and jobs prevents visible Duplicate actions and ineffective environment flags.
- **Dependency:** It must not replace authorization; it only describes feature availability.

## Optional roadmap ideas

### NTH-RM-01 — Templates and polls, only after contract completion

- Promote the existing gated code only when storage, authorization, duplication semantics, voting integrity, accessibility, and production tests are complete. Until then keep routes and UI absent and remove marketing claims.

### NTH-RM-02 — Offline authoring with explicit conflict semantics

- The current service worker is privacy-preserving and network-first. True offline writes should wait for a durable operation log, user-visible conflicts, revocation handling, storage quotas, and deploy-version migration.

### NTH-RM-03 — Organization administration and audit export

- For team deployments, add organization ownership, membership lifecycle, retention policy, audit export, and recovery roles before enterprise claims. Avoid bolting organization semantics onto email-address shares.

### NTH-RM-04 — Multi-instance operation

- Preserve the documented single-instance topology until WebSocket fanout, authorization/session invalidation, scheduler leadership, lease semantics, and shared event ordering are proven. Scaling background workers safely is useful before scaling web replicas.
