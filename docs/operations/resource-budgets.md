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
| Pan/frame target | 16.67 ms per frame | padded, tile-stable viewport calculation avoids per-pointer requests |
| Event-loop target | 50 ms maximum lag | verify with the browser Performance panel during the scale regression |
| Heap target | 64 MiB growth during a scale regression | compare a clean tab with each advertised item count |
| Collaboration regression | 50 concurrent clients | transport/admission tests exercise the bounded message path |
| Account export | 384 MiB uncompressed input, 256 MiB compressed archive | streaming meter fails closed; output is private and checksummed; see [account-exports.md](account-exports.md) |
| Export retention | 24 hours | durable delete job removes the private object |

The deterministic regression suite is `tests/unit/resource-budgets.test.ts`.
It serializes representative geometry at every advertised canvas size, checks
viewport stability, and admits the 50-client collaboration profile. Browser
timing and heap measurements are deliberately recorded in a real browser
profile rather than asserted against a noisy Node test runner; a release is
not considered scale-verified until those traces stay under the frame,
event-loop, and heap targets above.

AI has separate per-user token, cost, prompt-byte, and concurrency ceilings.
Those limits are configured with the `AI_*` environment variables and exposed
through the usage endpoint and settings page. See
`docs/operations/observability.md#ai-budget` for the operator response.
