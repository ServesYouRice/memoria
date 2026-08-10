# Memoria — Production Readiness Audit

Inspection-only audit of the repository at commit `083d65e`. **No production
code was modified.** No commands were executed — `pnpm test`, `pnpm build`,
`pnpm smoke`, and `pnpm test:e2e` were not run, so no finding rests on a test
result.

| File | Contents |
| --- | --- |
| [audit-plan.md](audit-plan.md) | Stack inventory, the 15 core user flows, method, scope limits |
| [ui-issues.md](ui-issues.md) | 15 findings — interface, UX, accessibility, state coverage |
| [logical-issues.md](logical-issues.md) | 20 findings — correctness, concurrency, data integrity |
| [security-issues.md](security-issues.md) | 13 findings — authN/authZ, exposure, abuse prevention |
| [performance-issues.md](performance-issues.md) | 13 findings — hot paths, query cost, scalability |
| [production-readiness.md](production-readiness.md) | Testing gaps, deployment risks, observability, go/no-go |
| [nice-to-haves.md](nice-to-haves.md) | 23 items — product completeness, DX, architecture, roadmap |

---

## The short version

The backend security and operations posture is **stronger than the product
surface**. Environment validation with production invariants, argon2id, session
revocation, share-aware authorization, Zod at every boundary, a durable outbox,
advisory locks, SSRF-protected unfurling, and a CI pipeline with SBOM,
dependency review, and real-PostgreSQL integration tests — all genuinely well
built.

The defects cluster in a narrow band: **places where the API and the UI disagree
about the shape of the data**, and **places where a feature degrades silently
instead of failing loudly**. Several blockers are the same function or the same
file.

---

## Blockers before production

| ID | Title | Where |
| --- | --- | --- |
| **LOG-01** | Item lists silently drop items — `hasMore` computed before byte truncation | [logic](logical-issues.md#log-01) |
| **PERF-01** | Same function is O(n²) — ~250 MB of string work for a 500 KB response | [perf](performance-issues.md#perf-01) |
| **LOG-02** | Live cursors stop after ~5 s of mouse movement and never recover | [logic](logical-issues.md#log-02) |
| **LOG-03** | Lockout checked *after* argon2 verify; locked accounts still sign in | [logic](logical-issues.md#log-03) |
| **SEC-01** | Login reveals account existence before checking the password | [security](security-issues.md#sec-01) |
| **SEC-03** | `shareToken` returned to every VIEW-role collaborator | [security](security-issues.md#sec-03) |
| **SEC-08** | AI endpoints have no per-user cost ceiling | [security](security-issues.md#sec-08) |
| **LOG-08** | Bulk canvas delete is an unrecoverable hard cascade | [logic](logical-issues.md#log-08) |
| **UI-04** | Public share links silently show only the first 50 items | [ui](ui-issues.md#ui-04) |
| **UI-05** | Canvas search deletes frames, arrows, shapes and text from view | [ui](ui-issues.md#ui-05) |
| **UI-03** | Share page reads `data.zoomLevel` when the API returns `data.canvas.zoomLevel` | [ui](ui-issues.md#ui-03) |
| **UI-01** | Dashboard reads `canvas.thumbnail`; the API returns `thumbnailKey` | [ui](ui-issues.md#ui-01) |
| **UI-02** | `/templates` returns 404 with a complete feature behind it | [ui](ui-issues.md#ui-02) |
| **UI-10** | Landing page claims "unlimited canvases" against a 200 cap | [ui](ui-issues.md#ui-10) |
| **UI-14** | Delete, duplicate, and paste fail into `console.error` | [ui](ui-issues.md#ui-14) |
| **PROD-05** | `/api/health` checks nothing while docs claim it checks the database | [prod](production-readiness.md#prod-05) |
| **PROD-03** | The project's own `DEC-014` verification gate has never been run | [prod](production-readiness.md#prod-03) |

**Recommendation: no-go until these close.** Most are small and localised.

---

## Efficient fix batches

These pair up — fixing them together is cheaper than separately.

| Batch | Findings | Note |
| --- | --- | --- |
| `bounded-response.ts` | LOG-01 + PERF-01 | Same 18-line function |
| `authorize()` in `auth.ts` | LOG-03 + SEC-01 | Same function, adjacent lines |
| `share/[token]/page.tsx` | UI-03 + UI-04 | Same file, same fetch |
| Mutation lifecycle | LOG-05 + LOG-06 + PERF-04 | `use-canvas-items.ts` |
| Soft delete | LOG-08 + LOG-04 + NTH-01 | One migration unlocks all three |
| WebSocket robustness | LOG-10 + LOG-11 + LOG-12 | One pass over the server |
| Response contract types | UI-01 + UI-03 + LOG-20 + NTH-13 | Root cause is shared |

---

## The pattern worth naming

Four separate shipped bugs — UI-01, UI-03, LOG-01, LOG-20 — are the same
underlying failure: **an API response shape that no type or test pins down, read
by a client that assumes a different shape.** `any` at the boundary lets each one
compile.

`src/lib/api/response-schemas.ts` already contains Zod schemas for these
responses. Exporting `z.infer<>` types from them and consuming those in the
client hooks would have turned three of these into compile errors. That single
change is the highest-leverage item in the audit — see
[NTH-13](nice-to-haves.md#nth-13-response-contract-types-shared-between-server-and-client).

---

## Severity counts

| | Critical | High | Medium | Low |
| --- | --- | --- | --- | --- |
| UI | 0 | 5 | 5 | 5 |
| Logic | 1 | 5 | 9 | 5 |
| Security | 0 | 3 | 9 | 1 |
| Performance | 0 | 4 | 6 | 3 |
| Production | 0 | 3 | 8 | 0 |

## Confidence and limits

Every finding was traced to specific source lines, and runtime-dependent values
(Zod defaults, constants, limits) were looked up rather than assumed. Two items
are explicitly marked **verify** rather than asserted — PERF-12 (canvas
virtualisation) and the `style-src` note in SEC-05 — because they could not be
confirmed from source alone.

Not covered: dynamic/penetration testing, dependency CVE review (CI handles it),
git-history secret scanning, load testing, and authorization depth of
`/api/agent/v1/*` beyond its route-level checks. The agent control plane handles
BYOK credentials and signed outbound webhooks and warrants a dedicated review
before it is widened beyond owner-only access.
