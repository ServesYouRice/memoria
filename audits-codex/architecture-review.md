# Architecture Review

## Current shape

Memoria is a Next.js App Router monolith with a custom Node/WebSocket server. REST/Prisma/PostgreSQL own durable canvas state; WebSockets and Redis provide transient collaboration signals. S3-compatible storage holds uploads, Auth.js credentials sessions authenticate users, and several in-process jobs/integrations add enrichment and AI/agent features. This is a reasonable early product topology, but several boundaries are only partially implemented.

## Findings

### ARCH-01 — Durable collaboration and transient collaboration have no common event contract

- **Severity:** High
- **Location:** REST item routes/hooks, WebSocket server, Redis pub/sub, client query caches
- **Description:** Durable item writes occur through REST and optimistic caches, while WebSockets distribute presence/cursors and selected ephemeral messages. A committed item mutation does not produce a versioned event that other clients consume.
- **Why it matters for production:** The UI appears collaborative without converging state. Adding replicas further fragments behavior because only part of the transient protocol is cross-instance.
- **Recommended fix:** Define a committed canvas event envelope with canvas ID, actor, event ID, entity/version, permission scope, and schema version. Publish after transaction commit through an outbox/event bus, reconcile clients by version, and retain a bounded replay path. Use CRDTs only if offline concurrent text editing is a deliberate requirement.
- **Blocker before production:** Yes for real-time collaboration.
- **Related risks or dependencies:** Resolves `LOG-01` and provides a foundation for `PERF-09`; authorization must be rechecked at subscription and mutation boundaries.

### ARCH-02 — External side effects lack a transactional outbox and durable worker boundary

- **Severity:** High
- **Location:** Verification email, webhooks/agent actions, object cleanup, scheduled retries
- **Description:** Database state changes and external actions are often performed sequentially in a request or process-local job. A crash between them can commit only one side; retries are inconsistent and not uniformly observable.
- **Why it matters for production:** Accounts can exist without delivered verification, agent state can disagree with webhook delivery, and deletion cleanup can be lost permanently.
- **Recommended fix:** Write domain change and outbox record in one database transaction; process with leased idempotent workers, bounded exponential retry, dead-letter review, and delivery/audit state. Avoid holding database transactions across network calls.
- **Blocker before production:** Yes for registration; also yes if webhooks/agent external actions or deletion guarantees are enabled.
- **Related risks or dependencies:** Requires idempotency keys, payload minimization/encryption, retention, and operator replay controls.

### ARCH-03 — Central modules combine too many policies and side effects

- **Severity:** Medium
- **Location:** `CanvasBoard.tsx`, canvas data/item hooks, agent service core, custom server
- **Description:** Large modules coordinate presentation, authorization capability assumptions, networking, persistence, shortcuts, jobs, and dialogs. Item types implement movement/save behavior inconsistently rather than through a common adapter contract.
- **Why it matters for production:** Fixes in one item type do not propagate to others, review becomes difficult, and state/race regressions have a wide blast radius.
- **Recommended fix:** After data contracts are corrected, extract explicit boundaries: canvas session controller, mutation queue, collaboration transport, capability policy, item adapter/renderer, and dialog commands. Enforce dependency direction and test contracts at each boundary.
- **Blocker before production:** No; targeted correctness fixes come first.
- **Related risks or dependencies:** Do not perform a broad rewrite. Use characterization tests and incremental extraction.

### ARCH-04 — Templates are represented by two divergent product systems

- **Severity:** Medium
- **Location:** Persisted `Canvas.isTemplate` library/routes and hard-coded `TemplateGallery` insertion flow
- **Description:** One feature treats an entire persisted canvas as a reusable template; another inserts predefined item arrays into the active canvas. Categories, asset semantics, permissions, lifecycle, and UI entry points differ.
- **Why it matters for production:** Users encounter inconsistent categories and outcomes, while developers must fix duplication, arrows, uploads, and validation in multiple paths.
- **Recommended fix:** Choose a single template domain model with a versioned manifest, portable relative geometry, explicit asset ownership/copy policy, category taxonomy, preview, and atomic instantiation. Make built-ins manifests in the same format.
- **Blocker before production:** No if all template entry points are disabled; yes if templates are marketed at launch because `UI-09`/`LOG-06` break normal use.
- **Related risks or dependencies:** Data migration and backward compatibility for existing `isTemplate` canvases.

### ARCH-05 — Models and hooks imply capabilities that production paths do not use

- **Severity:** Low
- **Location:** Polling item hook, canvas cache helpers, `AuditLog` model, FRAME/EMBED item paths and related abstractions
- **Description:** The codebase contains unused or partially wired alternatives—for example a polling hook that would mitigate stale collaboration but is not selected, cache helpers with no production call path, and modeled features with incomplete creation/render contracts.
- **Why it matters for production:** Dead paths obscure the supported architecture and can mislead maintainers into assuming reliability or audit coverage exists.
- **Recommended fix:** Inventory feature reachability, mark experimental capabilities behind explicit flags, delete truly dead code after evidence, and document the one supported read/write/cache path for each domain.
- **Blocker before production:** No.
- **Related risks or dependencies:** Confirm usage dynamically and via generated routes before removal.

### ARCH-06 — A custom stateful server constrains the supported hosting model

- **Severity:** Medium
- **Location:** `server.ts`, WebSocket runtime, in-process schedulers, deployment documentation
- **Description:** The application requires a long-lived Node process for WebSockets and jobs rather than a stock stateless Next.js/serverless deployment. This is valid, but hosting and scaling assumptions are not enforced as a product constraint.
- **Why it matters for production:** Deploying to an incompatible serverless platform can disable sockets/jobs, and scaling without shared event/job semantics produces inconsistent behavior.
- **Recommended fix:** Declare supported topologies. For launch, use one supervised stateful instance plus managed dependencies and strict limits; for scale, move jobs/event distribution to durable shared infrastructure before adding replicas.
- **Blocker before production:** No if the documented launch topology is single-instance and monitored.
- **Related risks or dependencies:** Sticky sessions alone do not solve durable item convergence or crash recovery.

## Architecture strengths to preserve

- Server-side authorization is generally rechecked rather than trusting UI role state.
- Authentication tokens and API keys are stored hashed; password hashing uses Argon2.
- Public/private asset reads pass through authorization rather than exposing a public bucket.
- Bookmark fetching includes redirect/DNS-aware SSRF controls.
- Production environment validation, CSP nonce support, typed schemas, Prisma transactions, Redis, and S3-compatible storage are solid building blocks.

## Recommended sequence

1. Specify capability/role and item-mutation contracts.
2. Replace ad hoc autosave with one serialized durable mutation queue.
3. Publish committed versioned item events and make clients converge.
4. Add an outbox/worker for email, cleanup, and external actions.
5. Unify template/asset ownership semantics.
6. Only then decompose large modules and consider multi-instance scale.
