# Review of the Testing Gap Proposals

Reviewed: 2026-08-14

## Executive verdict

Do not execute this directory as a second implementation backlog. It contains a
useful collection of test ideas, but it is not aligned closely enough with the
current source or the canonical Kanban to be an execution plan.

Most confirmed risks are already owned by `IMP-040` through `IMP-050`. Running
the proposed tasks independently would duplicate work, split production fixes
from their regression tests, and in a few cases reinstate requirements that the
audit reconciliation explicitly rejected. The right use of these documents is
as supporting test notes for the existing cards after the corrections below.

The strongest proposals are the bounded-response, auth ordering, SSRF pinning,
role-based response redaction, real-PostgreSQL optimistic-locking, WebSocket
budget/revocation, hostile raster, mobile, axe, and outbox lease tests. The
weakest are canvas soft delete, SVG sanitization, thumbnail fallback generation,
the Redis session-partition description, and the model-centric orchestration
plan.

## Cross-cutting findings

1. **The work is mostly already scheduled.** The live board already carries the
   verified audit findings in `IMP-040` through `IMP-048`, the deterministic
   unit/API gate in `IMP-050`, service-worker residue in `IMP-051`, and final
   production evidence in `IMP-038`. A test should ship with its owning card,
   not become a parallel `TEST-*` backlog.

2. **Tests and product changes are mixed together.** Many proposed “test tasks”
   require new production behavior first: connection-pinned HTTP, atomic AI
   quotas, outbox heartbeat renewal, proactive socket eviction, canvas soft
   delete, and an update-available UI. Each task needs to state whether it is a
   characterization test, a failing regression test plus production fix, or a
   test of behavior already implemented.

3. **Several source references are stale or nonexistent.** Examples include
   `src/app/api/v1/auth/login/route.ts`, `src/lib/auth/session-cache.ts`,
   `src/lib/cache/redis.ts`, `src/lib/security/ssrf.ts`,
   `src/features/canvas/hooks/use-canvas-collaboration-ui.ts`,
   `src/lib/outbox/job-processor.ts`, and
   `src/lib/thumbnails/thumbnail-generator.ts`. The current paths include
   `src/app/api/auth/[...nextauth]/route.ts`, `src/lib/api/session-cache.ts`,
   `src/lib/cache/redis-client.ts`, and
   `src/lib/utils/ssrf-protection.ts`.

4. **Some current coverage is understated.** There is already a real
   PostgreSQL byte-bound public-share test, a concurrent outbox claim test, a
   dead-letter/replay test, extensive client-IP unit coverage, responsive
   toolbar tests at 320/375/768 px, protocol-schema rejection, and thumbnail
   outbox tests. These do not close every gap, but new tasks should extend them
   rather than claim no coverage exists.

5. **Several proposed assertions are nondeterministic or encode guesses.** Wall
   clock timing parity, “close within 500 ms,” fixed multi-second sleeps,
   “complete under 3 seconds,” and informal O(n) timing checks will be flaky.
   Prefer fake clocks for local scheduling, observable events for async work,
   exact call/query counts where useful, real PostgreSQL/Redis for persistence
   semantics, and explicit bounded deadlines only at production-shaped edges.

6. **The verification commands need correction.** Unit/API tests should use
   `pnpm test -- --run <files>`. Integration tests must run through
   `pnpm test:integration` or directly with `vitest.integration.config.ts` and a
   real `TEST_DATABASE_URL`; they are excluded from the default Vitest config.
   E2E arguments flow through `scripts/run-e2e.mjs`, but that command builds and
   starts the full Docker stack, so it is not a cheap targeted-test command.

## File-by-file disposition

### `01-auth-session-gaps.md`

| Proposal | Verdict | Finding |
| --- | --- | --- |
| AUTH-01 lockout ordering | **Keep under IMP-041** | Confirmed. `authorize()` performs Argon2 before checking the pair lock and a correct password can reach success while locked. Assert no Argon2 call and no successful user result for a pre-locked account. |
| AUTH-02 account enumeration | **Keep, rewrite** | The route path is wrong and a wall-clock “constant time” unit test will be noisy. Test equivalent Auth.js error shape and call-path work for unknown vs wrong-password users, and specifically prove that unverified-email state is not exposed before password authority is established. Owned by IMP-041. |
| AUTH-03 Redis session partition | **Downgrade/correct** | The description is false: `getCachedSessionVersion()` falls back to PostgreSQL when Redis reads fail; it does not use an in-memory session fallback. Add a small Redis-rejection-to-PostgreSQL regression test if desired, but do not schedule a High-severity redesign from this claim. |
| AUTH-04 concurrent verification | **Valid uncovered candidate** | The verify route reads `usedAt`, then updates the token by ID without a `usedAt: null` compare-and-set. A real-PostgreSQL race test is justified. It should prove one atomic redemption and stable behavior for already-verified users. Fold it into IMP-041 only if that card's scope is explicitly expanded; otherwise schedule it once, separately. |

The proposed ten-request token race should call the route against real
PostgreSQL, not a Prisma mock. The expected status/error contract should be
chosen deliberately; “one 200 and nine 400” is not currently established by a
shared response contract.

### `02-realtime-collaboration-gaps.md`

| Proposal | Verdict | Finding |
| --- | --- | --- |
| WS-01 cursor storm | **Keep under IMP-045, rewrite** | The shared message budget and unthrottled client sends are confirmed risks, but the claimed abrupt disconnect was not demonstrated. Test cursor coalescing, separate ephemeral/social budgets, connection continuity, and chat/reaction progress for more than one rate window. Avoid a ten-second sleep. |
| WS-02 revocation eviction | **Keep under IMP-045, rewrite** | The server already revalidates on a 30-second authorization lease/heartbeat and closes with code `1008`; the client currently reconnects after every close. The important contract is bounded revocation plus terminal client behavior. `4403` and 500 ms are unsupported requirements unless the implementation card deliberately adopts them. |
| WS-03 Redis duplication/drop | **Replace with the confirmed risk** | ioredis reconnect/resubscribe is not shown to attach duplicate application listeners. The confirmed problem is stale remote presence/cursors after an instance disappears. Use two isolated server processes and real Redis to test fanout, instance loss, TTL expiry, and no duplicate delivery. Two in-process “mock servers” will share module globals and cannot prove the topology. |
| WS-04 mutation frames | **Keep as a small regression, downgrade** | The Zod discriminated union already rejects unknown message types and binary updates close with `1003`; the existing admission test covers arbitrary payload rejection. A stronger test may assert that forged frames cause no Prisma **writes**, but Prisma reads are expected for authorization, so “Prisma is never called” is wrong. This is not an uncovered Critical defect. |

The plan also misses IMP-045's largest UI defect: received remote cursors are
used for follow mode but are not rendered as pointers. Add a component/browser
assertion for named, visible remote cursors.

### `03-canvas-persistence-contracts-gaps.md`

| Proposal | Verdict | Finding |
| --- | --- | --- |
| PERSIST-01 byte truncation | **Keep under IMP-040, rewrite** | Confirmed. The current real-PostgreSQL test already sends 120 large items and asserts the 512 KiB bound plus `truncatedByBytes`; it simply misses continuation correctness. Do not preserve offset/`nextOffset`: IMP-040 correctly requires a stable authoritative cursor and exactly-once traversal across byte boundaries and concurrent inserts. |
| PERSIST-02 client/server parity | **Keep under IMP-040** | Confirmed. The public page reads the wrong envelope, only fetches one page, and hooks/cards carry hand-written thumbnail drift. Tests should parse serialized JSON (dates are strings on the wire), share schemas at fetch boundaries, and render the actual consumers with valid route fixtures. |
| PERSIST-03 optimistic collision | **Keep as a real-PostgreSQL regression** | The production item route already uses `updateMany({id, version, deletedAt: null})` under a canvas mutation lock. Existing mocked tests do not prove the race. Exactly one success and one 409 against PostgreSQL is a valuable regression test, not evidence that silent overwrite currently occurs. Carry it with IMP-044's mutation concurrency work. |
| PERSIST-04 canvas soft delete | **Reject** | The current canvas deletion contract is explicitly permanent and the UI says it cannot be undone. IMP-039 deliberately rejected canvas trash as an inferred launch requirement. This task would require a schema migration, retention policy, UI/API design, and a user product decision; it is not a missing unit test. |

The affected route named for list items is also wrong: list behavior currently
lives at `src/app/api/v1/canvas-items/route.ts` and the public equivalent at
`src/app/api/v1/share/[token]/route.ts`.

### `04-security-boundary-ssrf-gaps.md`

| Proposal | Verdict | Finding |
| --- | --- | --- |
| SEC-01 DNS rebinding | **Keep under IMP-043, strengthen** | Confirmed. Validation resolves the name, then `fetch(currentUrl)` resolves it again. A mock that merely flips DNS and expects a second check does not prove pinning. Test that the actual connection uses the vetted address while preserving Host/SNI, and re-run the same invariant for every redirect. |
| SEC-02 share-token redaction | **Keep under IMP-041** | Confirmed. The metadata route reads the entire canvas row and spreads it into VIEW/COMMENT responses. Test owner and non-owner personas and assert an explicit response schema/field selection, not just `undefined` on an ad hoc object. |
| SEC-03 AI budget | **Keep under IMP-048, strengthen** | Confirmed only for operator-enabled AI. A sequential unit counter is insufficient. Test atomic concurrent reservation, per-user token/cost/concurrency limits, bounded prompts, 429 Problem Details, and rollback/reconciliation when provider usage differs from the reservation. |
| SEC-04 forwarded-IP spoofing | **Partly covered; carry with IMP-042** | `deriveClientIp()` already has direct, trusted-proxy, multi-hop, malformed-chain, and IPv6 tests. The missing evidence is the supported production proxy/Compose path and its rate-limit identity. Add that production-shaped test when IMP-042 supplies the reference ingress; do not duplicate the unit cases. |

### `05-storage-outbox-workers-gaps.md`

| Proposal | Verdict | Finding |
| --- | --- | --- |
| WORKER-01 lease expiry | **Keep under IMP-047, strengthen** | Confirmed. Jobs are claimed in a batch on one lease and handled serially without renewal or per-handler deadline. There is already a PostgreSQL test proving only one initial claimant. Extend it with two real workers, lease renewal/loss, stale-owner completion rejection, graceful cancellation, and an idempotent external-side-effect seam. |
| WORKER-02 poison/dead letter | **Mostly already covered** | `failOutboxJob()` implements bounded exponential retry and the PostgreSQL suite proves transition to `DEAD` plus replay. The worker catches per-job errors and continues its loop. Useful residue is a worker-level “poison job does not block the next job” test and metrics/alert assertions owned by IMP-047; do not invent a second `FAILED` status or activity-log contract. |
| WORKER-03 hostile images | **Split** | SVG is already rejected entirely by magic-byte/type policy, so sanitizing and storing SVG contradicts the current boundary. Oversized decoded raster dimensions/frames/metadata remain a confirmed IMP-043 gap. Use small hostile JPEG/PNG/GIF/WebP fixtures with dangerous headers and assert bounded rejection before storage/scan side effects. |
| WORKER-04 thumbnail fallback | **Reject as written** | There is no server-side `thumbnail-generator.ts` or headless rendering path. The browser generates bytes and the outbox handler stores a revisioned candidate; existing tests cover install and stale-candidate deletion. A placeholder generator is new product behavior. Test actual retry, candidate cleanup, old-object cleanup, and displayed revision lifecycle under IMP-047/IMP-048 instead. |

The proposed fixed three-second delay should be replaced with controlled clocks
and database lease timestamps. External delivery duplication cannot be ruled out
solely by asserting a job row is completed once.

### `06-ui-accessibility-e2e-gaps.md`

| Proposal | Verdict | Finding |
| --- | --- | --- |
| UI-01 visual regression | **Keep as optional/targeted, lower severity** | Visual specs are intentionally excluded from the release suite and run through `test:visual`, but they depend on a Percy token and contain hard-coded credentials/canvas IDs and sleeps. First make a few high-value states deterministic and seeded. Pixel baselines are useful but are not a substitute for contract, layout-bound, and accessibility assertions. |
| UI-02 mobile/touch | **Keep under IMP-046/IMP-038** | Browser projects are desktop-only, so the browser gap is real. Responsive toolbar component tests already cover 320/375/768. Add production Playwright widths, coarse pointer/touch input, overflow bounds, dialogs, and keyboard alternatives; use only device projects that add engine/input value rather than multiplying the full expensive suite blindly. |
| UI-03 search dimming | **Keep under IMP-046, remove prescribed styling** | Search currently filters nonmatching items out and omits structural/text types. The reconciled card intentionally says to define the presentation. Test the chosen semantic behavior and preservation of structure; do not make opacity `0.2` an implicit product decision. |
| UI-04 axe | **Keep under IMP-046** | There is substantial component-level keyboard/list coverage but no full-page axe gate. Add `@axe-core/playwright` as a direct dependency and test primary composed routes/dialogs for critical/serious violations, while retaining manual keyboard and screen-reader acceptance for behavior axe cannot prove. |
| UI-05 service-worker update | **Split** | Cache rotation needs a regression test because the current activation filter deletes unrelated origin caches; that exact defect is owned by IMP-051. An “Update Available” notification does not exist and is a separate product choice. A focused service-worker event harness may be more deterministic than a full browser redeploy simulation. |

The proposals should also cover the confirmed duplicate accessible panel at the
route-composition level, not only run axe against the panel in isolation.

### `07-test-harness-performance-coverage-gaps.md`

| Proposal | Verdict | Finding |
| --- | --- | --- |
| HARNESS-01 import timeouts | **Keep under IMP-050, diagnose first** | Confirmed by the retained 2026-08-11 evidence: 407/414 tests passed and all seven failures were 5-second timeouts. Pre-bundling or setup warming is only a hypothesis. Profile the dynamic route import graph, move module load outside behavioral timing, and avoid a blanket global timeout increase. |
| HARNESS-02 async/mock leakage | **Keep under IMP-050, rewrite carefully** | Confirmed in `auth-verification.test.ts`. `vi.resetModules()` is not a universal cleanup and can make imports slower. Hoist/import once where safe, settle or cancel started work, restore timers/env/globals, and give every test isolated mock state. |
| HARNESS-03 coverage thresholds | **Keep as a ratchet, reject arbitrary targets** | The low global floor is real, but 80–90% directory targets have no measured baseline or staged path. Add risk-based scenario coverage first, publish current per-domain numbers, then raise non-regression thresholds incrementally. Authorization and validation mutation/scenario quality matters more than a vanity percentage. |
| HARNESS-04 release wrapper | **Do not duplicate the existing harness** | `scripts/run-e2e.mjs` already builds the image, starts the real Compose stack, runs Playwright, runs strict smoke, captures logs, and tears down volumes; CI already has integration, container-build, build, and E2E jobs. The unresolved item is green evidence and remaining journeys under IMP-038/DEC-014, plus exact image-digest linkage if required—not another orchestration script by default. |

The “under 3 seconds” focused-test target is unsupported. The acceptance
criterion should be reproducibility with meaningful behavior timeouts and a
recorded baseline, matching IMP-050's three consecutive full runs.

### `08-multiagent-orchestration-plan.md`

**Do not adopt this file as the repository execution plan.** It conflicts with
the local agent guide in important ways:

- The repository requires one card in `DOING`, the first eligible `READY` card
  unless the user names another, and only the coordinator may update the
  Kanban.
- One executor is the default. Parallel agents are allowed only for genuinely
  independent work with disjoint file ownership. The proposed domain agents
  overlap shared setup, API schemas, database fixtures, source routes, and CI.
- An advisor is for a concrete architecture, security, or debugging impasse,
  not a standing participant or a percentage-based token allocation.
- Model-brand/tier assignments and XML prompt formatting are orchestration
  preferences, not acceptance criteria. They will become stale independently
  of the repository.
- The phase roadmap ignores live dependencies and duplicates the canonical
  cards. Its “59 files / 414 tests” gate is a dated audit snapshot, not a stable
  suite contract.

If a reusable executor prompt is retained, it should name the active `IMP-*`
card, its exact acceptance criteria, allowed file ownership, targeted checks,
and the rule that tests must not be weakened. The card and local source should
remain the authority.

## Recommended execution mapping

Use the current Kanban and attach the corrected tests to their production card:

| Canonical card | Tests from this directory worth carrying |
| --- | --- |
| IMP-040 | Byte-bound continuation/exactly-once traversal, linear encoding, shared runtime response schemas, public-share and thumbnail consumer composition |
| IMP-041 | Lockout-before-Argon2, enumeration-safe auth paths, owner-only `shareToken`; consider the verification-token race after an explicit scope decision |
| IMP-042 | Real reference-proxy forwarded-IP/rate identity and configuration pass-through |
| IMP-043 | Connection-pinned DNS/redirects, hostile raster metadata, bounded request/content bytes |
| IMP-044 | Real-PostgreSQL optimistic update race and concurrent client rollback/reconciliation |
| IMP-045 | Cursor budget/coalescing, visible remote cursors, terminal revocation, real two-instance Redis expiry/fanout |
| IMP-046 | Search composition, unique accessible landmarks, axe/keyboard, mobile/coarse-pointer widths |
| IMP-047 | Outbox deadline/heartbeat/lease loss, poison-job continuation, dead-letter metrics and worker lifecycle |
| IMP-048 | Atomic AI budgets, thumbnail lifecycle/display, supported-scale load budgets |
| IMP-050 | Import profiling, async cleanup, three reproducible full unit/API runs, coverage ratchet baseline |
| IMP-051 | Service-worker cache ownership/upgrade behavior |
| IMP-038 | Remaining production journeys and retained release evidence after prerequisites and DEC-014 |

Do not create standalone tasks for canvas soft delete, SVG sanitization,
server-side thumbnail placeholder generation, an update-available UI, or a new
release wrapper without a separate product/architecture decision.

## Verification of this review

This was a source and backlog review. I inspected the testing documents, live
Kanban/tasks, relevant production modules, test/configuration files, CI, and the
existing audit reconciliations. I did not run the test suite: dependencies are
not installed in this workspace (`node_modules` is absent), and no code was
changed apart from this requested review file. The retained canonical evidence
in `IMP-049` records the last full unit/API result as 407/414 passing with seven
5-second timeouts.
