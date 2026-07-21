# Nice-to-Haves — Memoria as a Real Product

This file assumes the blockers in `logical-issues.md` / `security-issues.md` are handled and asks: what would make Memoria feel complete and trustworthy to real users and operators? Items already tracked in `REMAINING-WORK.md` are referenced rather than re-litigated.

---

## High-impact nice-to-haves

| Item | Why | Notes |
|---|---|---|
| **Share invitations with accept/decline + email notification** | Today a share silently appears when the matching email signs in; invitees are never told a canvas was shared with them, and owners get no confirmation anyone accepted. This is the single biggest trust gap in the collaboration story. | Tracked as PRODUCT-01; pair with UI-3 (deep-link return) so the invite email lands the user on the canvas. |
| **Registration modes for self-host (open/invite/closed) + allowed domains** | Also a security finding (S-2), but product-wise: an admin installing "a private notes tool for my team" expects invite-only by default. | Small: env flag + register-route gate + hidden register UI + invite issuance from settings. |
| **In-app + email notifications for meaningful events** | An `Activity` model and a notifications page exist, but there is no push/email for "X commented on your item", "Y accepted your share", "your account was locked" (S-3 remediation wants this too). | Start with lockout + share events; digest email later. |
| **Two-factor authentication (TOTP)** | Credentials-only auth on an internet-reachable personal knowledge base. Argon2 + lockout is a good floor, but TOTP is table stakes for a "security first" marketing claim (the landing page makes one). | NextAuth v5 supports it via custom flow; store secret encrypted like model credentials. |
| **Undo/redo completeness + accessible canvas interaction model** | Tracked (UX-03/06). Listing here because it is also the top product-feel gap: users forgive a missing feature, not a lost drawing. | |
| **Storage/AI usage visibility for users** | Server enforces 500 files / 100 MB / AI limits, but users can't see usage anywhere until they hit an error. A settings "Usage" card (files, MB, AI calls) turns hard failures into informed behavior. | Quota data already queryable (`uploadAsset` aggregate). |
| **Public share page hardening + polish** | `/share/[token]` exposes name + items read-only (verified email is excluded — good). Add: owner-controlled "allow comments/reactions", view counter, OG meta tags for link previews, and a "Made with Memoria" footer for growth. | Combine with S-4/S-6 fixes. |

## Product polish

- **Canvas empty state:** first-open canvas should offer a short interactive hint (create note / paste link / drop image). The dashboard has empty states (`DashboardContent.tsx:341-347`); the canvas itself drops users on a blank Konva stage.
- **Image placeholders and progressive loading** (UI-2): blur-hash or dominant-color placeholder while the proxy fetch resolves.
- **Session list & remote sign-out:** `sessionVersion` revocation exists; expose "sign out other devices" in settings (one button: bump version).
- **Trash retention policy label:** trash exists, but nothing tells users when items are purged (is soft-delete forever?). Decide and label; add a retention sweep job if "30 days" is chosen.
- **Meeting timer semantics** (tracked UX-14): label personal vs shared.
- **Keyboard-shortcut cheat sheet:** a `?` overlay; shortcuts exist (`src/lib/keyboard`) but are undiscoverable.
- **Offline page → real PWA story:** `sw.js` + manifest + offline page exist; define what offline actually promises (read-only cached canvases?) or scale the copy back — a service worker that half-caches an authenticated app causes stale-data confusion (tracked TST-13).
- **Consistent error toasts:** some flows toast, some silently console.error (ImageItem), some render Alerts; adopt one pattern (sonner is already installed).

## Developer experience improvements

- **Wire `scripts/check-bundle-size.mjs` into CI** (it exists, `ci.yml` never calls it — verified) and record route-level budgets (ties to PERF-10/11/12/13).
- **Unify correlation IDs** (`x-request-id` from proxy vs `x-correlation-id` in handlers — L-12) so a single grep traverses proxy log → API log → Sentry event.
- **Delete dead code:** `src/lib/rate-limit/endpoint-limits.ts` (L-2), the legacy plaintext API-key branch after migration (S-10), `vercel.json` (deployment story moved on; keeping it invites someone to deploy serverless where WebSockets don't work).
- **`pnpm doctor` additions:** warn when `AUTH_URL` is https but no proxy-trust config (S-1), when `CRON_SECRET` is unset (scheduler will crash-loop), when `CORS_ALLOWED_ORIGINS` diverges from `AUTH_URL` with credentials on (S-9).
- **Route-handler consolidation** (tracked MNT-06): migrate the ~6 legacy try/catch routes onto `withApiHandler` so cross-cutting fixes apply once.
- **Shared response schemas for client hooks** (L-13): even 3 Zod schemas (items list, item, canvas) would catch server/client drift in CI.
- **Seed script for demo data:** `prisma/seed.ts` exists; extend with a realistic 500-item demo canvas to make perf work reproducible (feeds T-6).

## Architecture / stack recommendations

- **Presigned S3 URLs (or a caching CDN) for asset reads** once P-2's streaming fix lands — takes Node out of the hottest byte path entirely; the private-read model can keep short-lived (60 s) presigned GETs.
- **Transactional outbox as a general pattern** (SEC-12): once built for webhooks, reuse for verification emails (L-11) and notification sends — same at-least-once semantics needed everywhere.
- **Delta sync channel:** P-4's delta polling is the stepping stone; long-term, pushing `itemChanged` events (id + version only) over the existing WebSocket and letting clients fetch deltas over HTTP preserves the "REST is the write authority" invariant while killing the 5 s full refetch.
- **Job runner:** the scheduler container is a bare loop for one job. Before adding retention sweeps (COR-30), thumbnail generation (PERF-05/06), and backoff-aware bookmark refresh (COR-16), adopt a minimal DB-backed job table (or BullMQ on the existing Redis) so jobs get retries, locks, and observability once.
- **Rate-limit architecture:** merge the dead `endpoint-limits.ts` design (per-user keys, headers) into the live middleware (L-2/S-1) rather than maintaining two mental models.
- **Multi-user workspaces:** the data model is single-owner (`Workspace.userId`); real team use will eventually need workspace membership. Not v1 — but avoid deepening single-owner assumptions in new code (agent scoping is already canvas-level, which helps).

## Future roadmap ideas

- Canvas-to-canvas links and backlinks (knowledge-graph primitives already exist in the agent slice — `KnowledgeEntity`/`KnowledgeRelation` could surface to users).
- Import flows (Markdown folder, browser bookmarks HTML, Miro/FigJam JSON) — export exists (PDF, account export); import is the missing half of trust.
- Version diffing UI (versions exist; "what changed between v3 and v7" doesn't).
- Native share-target PWA integration (share a URL from mobile straight into a bookmark item — the extension clip endpoint `/api/v1/extensions/clip` is most of the backend).
- Admin panel for self-host operators: user list, storage totals, lockout resets, registration invites — currently everything is psql-only.
- Public template gallery with curation (template models and usage counters already exist).
