# Nice-to-Haves — Product Completeness & Polish

These are not blockers. They are what would make Memoria feel like a finished, trustworthy
product. Grouped as requested.

---

## High-impact nice-to-haves

1. **Real-time updates without split-brain.** Users expect changes to appear live and *stay*. Resolving the REST-vs-Yjs model (L-4) and then presenting a clean "others are editing / saved" indicator would turn the current fragile mechanism into a headline feature.
2. **Trash / restore for canvases and items.** Soft deletes already exist in the schema (`deletedAt`, `deletedById`) but there's no UI to view or restore deleted items or canvases. Users delete things by accident; "Recently deleted" builds trust cheaply.
3. **Share management UX.** Sharing is email-based (`CanvasShare`) but there's no visible "Manage access" panel showing who has what role, pending invites, or a way to revoke. Public-link sharing exists; add copy-link, link expiry, and password-protected links.
4. **Notifications that are actually notifications.** `/notifications` is an activity feed of your *own* actions. Real value: notify when someone shares a canvas with you, comments on your item, or edits a shared board — with unread counts on the bell icon.
5. **Onboarding for the empty state.** After bootstrap a user lands on an empty dashboard/Inbox. A first-run tour, sample canvas, or template picker would dramatically improve activation.
6. **Email verification + password-strength UX end to end.** The backend supports verification tokens and zxcvbn strength, but login doesn't require verification (S-9) and lockout messaging is swallowed (U-3). Closing this loop makes accounts feel real and secure.

## Product polish

- Replace all native `confirm()`/`alert()` with themed dialogs (U-1).
- Remove disabled OAuth buttons or actually implement Google/GitHub (U-2).
- Dark-mode the canvas surface and items (U-5).
- Finish or hide: presentation mode, paste, undo-for-everything, AR/Whisper/Serendipity/Autopilot (U-7, U-8, U-9).
- Persist and restore viewport (zoom/pan) per canvas (L-9) — users expect a board to reopen where they left it.
- Consistent loading skeletons and empty states across all list pages (U-10, U-15).
- Canvas keyboard shortcuts discoverability (there's a `KeyboardShortcutsDialog` — ensure it's reachable and complete) and don't fire shortcuts while typing (U-13).
- Toast copy consistency and a global 401 → "your session expired, sign in again" flow (U-12).
- Bulk actions on the dashboard (multi-select canvases: move to workspace, delete, duplicate).
- Rename the stale `canvascollect` brand strings (service worker cache, error `type` URLs like `https://canvascollect.com/errors/*`, container names) to `memoria` for coherence.

## Developer experience improvements

- **Land migrations and a seed-for-dev flow** (L-1) — currently the single biggest DX cliff; a new contributor can't get a working DB from the committed repo.
- Consolidate the two rate-limiter implementations and the two e2e test trees (L-18, T-6).
- Add a `CONTRIBUTING.md` and a one-command dev bootstrap that actually works from a clean clone (the scripts exist; verify they work without migrations).
- Coverage thresholds in CI (T-4); run e2e against a production build (T-5).
- Delete dead code (`SavedView`, `auth-options.ts` shim, `/api/ai/generate` shim, `vercel.json`) to reduce "which one is real?" confusion.
- Type the many `any`s in the collaboration/board layer (`remoteMessages: any[]`, WS `payload: any`) — they're where the L-11 validation gap lives.
- ADRs are excellent; add an ADR for the final real-time decision (L-4) and the deployment target (D-3).

## Security hardening (beyond the launch blockers)

- Dedicated credential-encryption key with a documented rotation/re-encryption path (S-5).
- Redis-backed, IP-trustworthy rate limiting; per-user limits on expensive endpoints (AI, upload, unfurl) in addition to per-IP (S-2, L-3).
- CAPTCHA / invite-gating for registration on public instances (S-9).
- Session management UI: list active sessions/devices (schema has `deviceInfo`/`revokedAt`), "sign out everywhere" (ties to L-5).
- 2FA/TOTP for owner accounts.
- Audit-log surfacing: the `AuditLog`/`AgentAction`/`ChangeSet` models exist — expose an admin/audit view so the audit trail is actually usable.
- Constant-time comparisons for bootstrap token and legacy API keys (S-6, S-7).
- Egress allowlist/pinned-IP fetch for SSRF hardening (S-10).

## Abuse prevention & limits

- Per-account quotas surfaced in the UI (uploads already capped at 500 files / 100 MB — show usage; add canvas/item caps).
- Rate limit WebSocket chat/reactions separately from Yjs traffic (currently one 6000/min bucket, L-11).
- Content-length and per-field size limits on notes/bookmarks (large JSON `content` blobs are unbounded).

## Missing operational tooling / observability

- **Admin panel:** no way to manage users, disable accounts, inspect canvases, or handle abuse reports. Even a minimal read-only admin view is valuable.
- **Metrics beyond health:** connection counts and active-doc counts are computed (`getConnectionCount`, `getActiveDocumentCount`) but not exported — expose Prometheus/OpenTelemetry metrics for WS connections, doc count, persistence lag, rate-limit hits.
- **Structured audit trail surfacing** (see above).
- **Readiness/liveness split + dependency health** (D-6).
- **Scheduled backups with a tested restore + off-host copies + MinIO backup** (D-7).
- **Cleanup jobs** for expired tokens and idempotency keys (D-5, L-14).

## Data export / import, backup, recovery

- **User-facing export:** `jspdf` and `export-utils` exist for canvas export, but there's no account-level "export all my data" (GDPR-style) or canvas JSON import. Add export/import for portability and compliance.
- **Per-canvas version restore is present** (time machine) — good; extend to canvas-level and account-level recovery.
- **Documented, drilled restore procedure** (docs exist; execute one).

## Architecture / stack recommendations

- **Commit to one real-time strategy** (Yjs-authoritative *or* REST-authoritative + WS relay). The current dual path is the root of the most serious data bug (L-4) and half the performance issues (P-2, P-5).
- **Move blob-ish data out of Postgres rows:** thumbnails (P-3) and large `content` JSON belong in object storage / dedicated tables.
- **Externalize ephemeral server state:** in-memory rate-limit map and per-instance Yjs caches prevent horizontal scaling; use Redis for both (rate limiting) and a documented single-writer-per-canvas or Redis-coordinated model for docs (scaling).
- **Introduce a job queue** (BullMQ on the existing Redis) for bookmark refresh, embeddings, cleanup, email — instead of HTTP cron routes with a shared secret.
- **Consider Auth.js stable** once out of beta (currently pinned to `5.0.0-beta.25`); beta auth in production is a supply-chain/stability risk.
- **PgBouncer** in front of Postgres for the stateful server (P-9).

## Future roadmap ideas

- Comments/mentions with notifications; presence-aware "who's here" avatars with names.
- Templates marketplace / shared template gallery (models exist: `isTemplate`, `usageCount`, `templateCategory`).
- The knowledge-graph + embeddings models (`KnowledgeEntity`, `ItemEmbedding`) hint at semantic search / "related items" — a strong differentiator if finished.
- Mobile-first companion (once touch on the canvas works, U-4).
- Offline-first with the PWA done properly (U-14) — Yjs makes real offline editing feasible.
- Agent automation surfaced as user-facing "assistants" (the whole `/api/agent/v1` + MCP foundation is a genuine platform play once the core is stable).
