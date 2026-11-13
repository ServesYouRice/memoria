# Resource budgets

Memoria's launch profile keeps large canvases interactive by separating the
small whole-canvas index from viewport-sized item payloads. These are enforced
ceilings, not hints; a corrupted canvas or archive is rejected rather than
silently truncated.

| Surface | Launch budget | Enforcement/evidence |
| --- | ---: | --- |
| Canvas items | 2,000 items; regression sizes 500, 1,000, and 2,000 | capacity transaction lock and geometry/index route |
| Geometry index | 512 KiB serialized JSON | `/api/v1/canvas-items/geometry` returns 413 above the budget |
| Viewport response | 512 KiB serialized JSON | bounded response helper emits an authoritative cursor |
| Viewport page | 250 detailed items | 512-pixel tile quantization and cursor pagination |
| Accessible organizer | 50 detailed items per page | cursor-paginated infinite query and explicit item count |
| Pan/frame target | 16.67 ms per frame aim; 95% of frames within 50 ms (pan, drag) or 67 ms (zoom) at 2,000 items | padded, tile-stable viewport calculation avoids per-pointer requests; `pnpm gate perf` (see [Canvas speed](#canvas-speed-imp-103)) |
| Event-loop target | 50 ms maximum lag | verify with the browser Performance panel during the scale regression |
| Heap target | 64 MiB growth during a scale regression | compare a clean tab with each advertised item count |
| Collaboration regression | 50 concurrent clients | transport/admission tests exercise the bounded message path |
| Account export | 384 MiB uncompressed input, 256 MiB compressed archive | streaming meter fails closed; output is private and checksummed; see [account-exports.md](account-exports.md) |
| Export retention | 24 hours | durable delete job removes the private object |
| Saved page text | 256 KiB per link, 64 MiB per account (UTF-8) | `storePageCopy` cuts a page at the link budget and keeps no text once the account budget is full; `RESOURCE_BUDGETS.pageCopy` |

The deterministic regression suite is `tests/unit/resource-budgets.test.ts`.
It serializes representative geometry at every advertised canvas size, checks
viewport stability, and admits the 50-client collaboration profile. Browser
timing and heap measurements are deliberately recorded in a real browser
profile rather than asserted against a noisy Node test runner; a release is
not considered scale-verified until those traces stay under the frame,
event-loop, and heap targets above.

Saved page text (IMP-094) is kept for every saved link while the person
keeps link reading on. At the launch scale (200 canvases of 2,000 items) an
account could otherwise hold gigabytes of web text, so the account budget
caps it at 64 MiB; that also keeps it well inside the account export's input
budget. Links saved after the budget is full keep their title and summary
but no page text.

AI has separate per-user token, cost, prompt-byte, and concurrency ceilings.
Those limits are configured with the `AI_*` environment variables and exposed
through the usage endpoint and settings page. See
`docs/operations/observability.md#ai-budget` for the operator response.

## Canvas speed (IMP-103)

`pnpm gate perf` (or `pnpm test:perf`) builds the image, starts the e2e
stack and runs `tests/perf/canvas-speed.perf.ts` in Chromium at 1440×900. It
imports a full canvas of 2,000 items (1,500 notes, 300 links, 100 groups,
100 arrows), opens it, waits for the live document to settle, then pans
with Space-drag, zooms with 30 wheel steps and drags a note. Frame time is
the gap between animation frames while the action runs; a "long frame" is
over 50 ms. The test fails when a budget is missed. Budgets live in
`tests/perf/budgets.ts`; change both places together.

| Measure | Budget | Run 1 | Run 2 | Run 3 |
| --- | ---: | ---: | ---: | ---: |
| Open (navigation to first notes drawn) | 6,000 ms | 1,521 ms | 1,406 ms | 1,707 ms |
| Pan, 95th percentile frame | 50 ms | 33.4 ms | 33.3 ms | 33.3 ms |
| Pan, long frames | 10% | 1.4% | 1.4% | 0.7% |
| Zoom, 95th percentile frame | 67 ms | 50 ms | 50 ms | 50 ms |
| Zoom, long frames | 10% | 5.0% | 0.9% | 2.8% |
| Drag a note, 95th percentile frame | 50 ms | 16.8 ms | 16.7 ms | 16.8 ms |
| Drag a note, long frames | 10% | 1.1% | 1.2% | 1.3% |

Measured on 2026-11-12 in the cloud dev container (shared CPU, the whole
stack on the same machine), production image. Frames land on 16.7 ms steps,
so 50 ms is three frames and 67 ms is four; zoom gets four because every
wheel step rescales and redraws the board.

The first run found, and IMP-103 fixed:

- Pan, 95th percentile 66.8 ms: every pointer move re-rendered the whole
  board, its toolbar and panels. The item layer is now memoized, the drawn
  set is recomputed only per 256-pixel step, and during a Space-drag Konva
  moves the stage itself while React follows once per step.
- Zoom and long pans blanked the board to its loading skeleton while the
  next viewport tile loaded; the items query now uses a deferred viewport,
  so the board stays on screen.

## Small set-up memory (IMP-100)

Measured on 2026-11-12 with `docker stats`, Docker 29 on Linux x86-64, the
image built from this repository, a fresh database and one owner account.
"At rest" is two minutes after `pnpm setup:small` finished, with no one
signed in.

| Part | At rest | After sign-in and one upload |
| --- | ---: | ---: |
| app | 180 MiB | 179 MiB |
| sync | 189 MiB | 257 MiB |
| outbox-worker | 185 MiB | 176 MiB |
| scheduler | 18 MiB | 18 MiB |
| PostgreSQL | 81-88 MiB | 87 MiB |
| Redis | 7 MiB | 7 MiB |
| **Total** | **about 670 MiB** | **about 725 MiB** |

A 1 GiB server runs it with little room to spare; 2 GiB leaves room for
editing sessions and imports. The full set-up adds the Caddy gateway, the
object store and the two backup services on top of these.

