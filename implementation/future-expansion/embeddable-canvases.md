# Embeddable canvases

Status: `PARKED`. Not on the live Kanban and not executable. Promote one card at
a time into `../tasks/` when the prerequisites below have shipped.

Design discussion and the two source proposals are archived under
`../archive/2026-07-26/fe-roundtable/`. This document supersedes them.

## Goal

A host application — a stream page, a classroom, an event site — shows a Memoria
canvas beside its own UI, and its visitors leave notes on it. The host provisions
a canvas through an API call with no manual setup, and the canvas disappears when
the session ends unless someone chooses to keep it.

This is the inverse of the `EMBED` canvas item, which places external content
inside a canvas. Use "widget" for this direction.

## Settled decisions

| # | Decision | Answer |
| - | -------- | ------ |
| 1 | Who may embed | The operator's own apps first; design so a third-party registry can be added later |
| 2 | Provisioning | Host apps create session-scoped canvases via API with near-zero configuration |
| 3 | Release axis | Disposable canvases before persistent ones |
| 4 | First write mode | Anonymous and host-asserted identity in the same release |
| 5 | Identity default | Anonymous; host-asserted credentials optional per session |
| 6 | Contribution lifespan | Owner-chosen per embed — persistent canvases only, FE-06 |
| 7 | Read-only milestone | None. Read-only is a mode, not a release |
| 8 | Keeping a session canvas | Allowed, as owner-authored copies with retained attribution |
| 9 | Session end | Explicit host call, idle timeout without reconnect, and a hard TTL backstop |
| 10 | Privacy responsibility | The host application is the controller; the Memoria operator is the processor |
| 11 | Note placement | Designated contribution region, server-validated |
| 12 | First write scope | Notes only. No comments, images, rich text, polls, uploads, or AI |

## Architecture

**Boundary.** An iframe at `/embed/[embedId]`. That route alone derives CSP
`frame-ancestors` from the stored per-embed origin list and omits
`X-Frame-Options`. Every other route keeps `frame-ancestors 'none'` and `DENY`.
Framing, CORS, and `postMessage` are separate concerns — iframe navigation does
not consult CORS, and wildcard origins are not a default for widgets.

**Credentials.** No third-party cookies. The host server authenticates with an
integration credential and receives a single-use, short-expiry code; the iframe
exchanges that code for a short-lived ticket carrying audience, origin, canvas,
embed, participant, capabilities, expiry, and a replay ID. Persist revocation and
audit state, not every request.

**Principals.** One discriminated runtime contract shared by HTTP and WebSocket:

```text
ConnectionPrincipal = UserPrincipal | EphemeralViewerPrincipal | CanvasParticipantPrincipal
```

Read-only viewers stay ephemeral and never reach PostgreSQL. Contributors need a
persistent `CanvasParticipant` before their first durable write.

**Capabilities, not roles.** Participants receive capabilities directly from
embed policy — `canvas:view`, `note:create`, `own-note:update`,
`own-note:delete`. They are never materialised as an `EDIT` `CanvasShare`.
`ShareRole` has only `VIEW | COMMENT | EDIT`, so this vocabulary must come from
IMP-008.

**Authorship.** `CanvasItem.createdById` is a required `User` relation, so no row
can currently be authored by a non-user. Add participant alternatives beside the
existing actor columns, require exactly one creation actor via a hand-written
PostgreSQL constraint, and expose a discriminated actor type in application code.
Prisma models neither CHECK constraints nor the XOR, so validate in both layers
and test the constraint directly. Index only `createdByParticipantId` initially.
Do not touch `Comment.userId` — comments are out of scope.

**Revocation.** `CanvasEmbed` carries a `policyVersion` included in every ticket.
Revoking, pausing, changing origins, or reducing capabilities increments it and
publishes a control event. Every write verifies the embed is active and the
version still matches under a row lock; whichever operation takes the lock first
defines ordering. Sockets close on the control event. A write already committed
stays committed — the server does not claim to cancel durable work.

**Session lifecycle.** A session canvas ends on an explicit host call, on idle
timeout with no reconnect, or at a hard maximum TTL. All three are required;
idle detection alone fails when a client vanishes uncleanly. Expiry is enforced
by a purge job through IMP-014.

**Isolation.** Session canvases must not appear in dashboards, search, templates,
exports, or duplication, and have no version history. This is what keeps the
retention problems of persistent canvases out of release 1.

**Keeping a canvas.** Promotion copies contributions into owner-authored items
carrying an immutable attribution field — original display name and promotion
timestamp — and does not migrate participant records. The widget must state that
an owner may keep contributions permanently.

## Release 1 — disposable session canvases

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| FE-01 | `CanvasEmbed` and `EmbedIntegration` records, per-embed exact origin allowlist, route-scoped framing headers, revoke and rotate | IMP-004, IMP-033 |
| FE-02 | Session provisioning API, TTL and idle/explicit end, purge job, exclusion from all normal canvas surfaces | FE-01, IMP-014 |
| FE-03 | Ticket issuance and validation shared by HTTP and WebSocket, capability enforcement, key rotation, clock-skew tests | FE-01, IMP-006, IMP-008 |
| FE-04A | `CanvasParticipant`, participant actor columns, database and application invariants | FE-03 |
| FE-04B | Note-only writes in a designated region, anonymous by default with optional host-asserted identity, committed delta sync | FE-04A, FE-02, IMP-007, IMP-017, IMP-018 |
| FE-05 | Moderation, per-integration session budgets, linearizable revocation, promotion with retained attribution, privacy surface | FE-04B |

Public write traffic waits for FE-05. FE-04B may run an operator-only pilot.

## Release 2 — persistent canvas embedding

FE-06 embeds an owner's existing canvas with owner-chosen contribution retention.
It inherits every problem release 1 avoids, all verified in the current code:

- `CanvasVersion.snapshot` is a JSON copy of item state, so expiring or deleting
  a contribution leaves copies in retained snapshots.
- All three restore paths soft-delete items absent from the snapshot, so
  excluding contributions at capture would delete live ones on restore. Capture
  and restore must share one scope.
- `duplicate/route.ts` copies every item and rewrites `createdById` to the
  duplicating user, which would launder contributions past expiry, deletion, and
  moderation. Templates share that path.
- Trash retains soft-deleted content for the DEC-008 window and must be purged
  on a deletion request.
- `WorkspaceCheckpoint` is a second denormalised copy of items and comments.

Depends on FE-05, IMP-010, and IMP-026. Before FE-06, inventory every store that
can copy participant content; content may enter only stores with a declared purge
path and retention period.

## Standing rule for other work

IMP-014's outbox payloads must reference participant content by ID and never
copy note bodies. Cheap to honour before the table exists; expensive to retrofit.

## Open items

- Numeric limits: concurrent sessions per integration, items per session, idle
  and maximum TTL, participant rate budgets.
- The controller/processor split needs terms in the integration agreement and
  review by someone qualified. This plan does not encode a legal claim.
- Branding: unbranded, Memoria-attributed, or operator-configurable.
- A third-party client registry, if embedding is ever opened beyond the
  operator's own applications.

## Board prerequisites

IMP-004 and IMP-033 for FE-01. IMP-014 for FE-02. IMP-006 and IMP-008 for FE-03.
IMP-007, IMP-017, and IMP-018 for FE-04B. IMP-010 and IMP-026 for FE-06.
