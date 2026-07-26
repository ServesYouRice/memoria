# Embeddable canvases in third-party apps

Not scheduled. See `README.md` in this folder.

## Goal

A canvas can be placed inside an application Memoria does not control — for
example beside a stream player — so viewers read and write notes there. The
reference model is the Discord server widget: a small live surface hosted on
someone else's page, served and secured entirely by the origin app.

Distinct from `EmbedItem.tsx` and DEC-011, which embed external content _into_ a
canvas. That is the opposite direction. Use "widget" for this direction to keep
the vocabulary separable.

## The gating decision

Cost differs by an order of magnitude across three readings of "tied to their
accounts".

| Model | Identity in the widget | Cost | Notes |
| ----- | ---------------------- | ---- | ----- |
| A | The viewer's Memoria account | Medium-large | The Discord widget model. Host app never touches identity. |
| B | The host app's own users | Very large | Full multi-tenancy: tenant model, user provisioning and mapping, isolation, quotas, billing. A platform business, not a feature. |
| C | A room, not a person | Small-medium | Pseudonymous notes keyed to a canvas and display name. |

Recommendation: ship C, then add A on top. C already satisfies "everyone can
leave notes next to the stream"; A adds account linkage. B is out of scope
unless the product direction changes.

## What the codebase already supports

- JWT sessions (`src/lib/auth.ts`) — minting a narrower widget token is a
  variation on existing work, not new infrastructure.
- A scoped bearer-token model already exists and is enforced:
  `AgentProfile.allowedCanvasIds` in `prisma/schema.prisma` plus
  `assertCanvasScope()` in `src/lib/agents/policy.ts`, against argon2-hashed
  `mat_` tokens in `src/lib/agents/auth.ts`. This is close to the shape a widget
  credential needs.
- An unauthenticated canvas view already ships: `src/app/share/[token]/` and
  `src/features/canvas/components/ReadonlyCanvasItemLayer.tsx`.
- CORS already supports wildcard-subdomain origins
  (`src/middleware/cors.ts`).
- The custom Node server owns the WebSocket upgrade, so ticket-based admission
  is implementable without platform constraints.

## What blocks it

1. **Framing is globally denied.** `frame-ancestors: 'none'` in
   `src/middleware/csp.ts` and `X-Frame-Options: DENY` in
   `src/lib/security/headers.ts`. Must become per-route and per-tenant; a global
   relax would make the whole app clickjackable.
2. **WebSocket auth reads session cookies.**
   `src/lib/collaboration/websocket-server.ts` parses the session cookie off the
   upgrade request. In a third-party iframe that is a cross-site cookie, which
   Safari blocks and Chrome is removing. Live collaboration in a widget cannot
   use the current auth path at all. Short-lived canvas-scoped tickets are
   required — already specified as IMP-006.
3. **No concept of a third-party client.** `CORS_ALLOWED_ORIGINS` is a single
   global env list. Third-party embedding needs client registration, per-client
   origin allowlists, and rate limits keyed on the client rather than the IP.
4. **Widgets multiply the weakest paths.** A widget is a small viewport, but
   `src/lib/hooks/use-canvas-items.ts` loads the full item set and polls
   (IMP-024). Embedded links are also the links most likely to leak, which is
   IMP-033.

## Prerequisites

Do not start before **IMP-004** and **IMP-006** ship. Opening iframe embedding
to arbitrary origins while WebSocket admission is tokenless and rate-limit
identity collapses behind a proxy would expose the weakest boundary to the
widest audience. IMP-033 should also land, since widget URLs are leak-prone.

## Cards this would become

Promote in order; each is independently shippable.

**FE-A — Read-only canvas widget.** Serve `/share/[token]` in a frame for an
owner-configured allowlist of ancestor origins. Per-canvas allowed ancestors,
not a global header change. Reuses the existing public share view. Small.

**FE-B — Room-identity write widget (model C).** Pseudonymous participants with
display names, no account. Needs the IMP-006 ticket, per-widget abuse controls,
and a bounded item budget. Medium.

**FE-C — Third-party client registry.** Registered clients with an ID, secret,
origin allowlist, per-client quotas, and revocation. Prerequisite for model A
and for anyone embedding who is not the operator. Medium.

**FE-D — Account-linked widget (model A).** OAuth-style popup consent granting a
canvas-scoped widget token, modelled on the existing agent-profile scoping.
Depends on FE-C. Medium-large.

## Open questions for the user

- Which identity model — A, B, or C? Recommendation above is C then A.
- Who may embed: only the operator's own apps, or any registered third party?
  This decides whether FE-C is required or skippable.
- Does a widget participant count against the canvas owner's quotas
  (DEC-008), and who pays for AI actions triggered from a widget?
- Does widget traffic change the supported launch topology (DEC-007)? Embedded
  load is not traffic the operator controls.
