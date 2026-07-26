# FE roundtable — embeddable canvases

Status: `PARKED` — synthesis only, not executable and not on the live Kanban.

Inputs:

- [Codex proposal](embeddable-canvases-codex.md)
- [Opus proposal](embeddable-canvases-opus.md)

## Roundtable conclusion

Both proposals agree on the correct technical direction: an iframe-first widget,
route-specific framing permission, short-lived scoped credentials, explicit
origin validation, and HTTP/Prisma remaining the durable write authority.

The main adjustment is identity taxonomy. “Users from the host app” does not
automatically require full Memoria multi-tenancy. Split it into two cases:

| Model | Identity | Scope | Assessment |
| ----- | -------- | ----- | ---------- |
| `R` | None | Read-only embed | Smallest useful release. |
| `C` | Pseudonymous participant | One embed/canvas | Good first write mode. |
| `A` | Existing Memoria account | Canvas-scoped consent | Medium-large, optional. |
| `B1` | Host-app issuer/subject | One integration/embed | Medium-large; supports the user's account-linking goal without provisioning full Memoria users. |
| `B2` | Federated first-class account | App/workspace-wide | Very large; this is the platform/multi-tenant direction Opus warns about. |

Recommended order: `R`, then `C`, then `B1` where the host application already
has accounts. Add `A` if cross-site Memoria identity is valuable. Treat `B2` as
a separate product strategy, not a widget requirement.

## Agreements to preserve

- Keep framing denied for every normal Memoria route. Permit only a dedicated
  `/embed/[embedId]` response for the exact stored ancestor origins.
- Cross-site cookies are not a reliable widget authentication mechanism.
- A canvas ID or durable public-share URL is not a WebSocket credential.
- Use a compact embed surface, not the full application shell.
- Give public contributors narrower capabilities than `EDIT`.
- Publish live item events only after the corresponding database transaction
  commits; WebSockets remain transport, not an unvalidated write path.
- Enforce quotas and moderation before opening write widgets to public traffic.
- Use an iframe snippet first. A web component SDK is a later convenience layer,
  not an MVP dependency.

## Adjustments to the Opus proposal

### 1. Split identity model B

Opus correctly rejects full multi-tenancy as an incidental widget feature, but
its model B combines two substantially different designs. Mapping
`(integration issuer, external subject)` to an embed-scoped participant does not
require billing, tenant workspaces, or a first-class Memoria user. That is `B1`
and is a reasonable later widget capability. Promoting external users into
reusable Memoria accounts is `B2` and remains out of scope.

### 2. Do not reuse agent credentials as browser credentials

`AgentProfile.allowedCanvasIds` and `assertCanvasScope()` are useful examples of
server-side canvas scoping. Long-lived Argon2-hashed agent tokens are not the
right browser mechanism. Widget access additionally needs audience, parent
origin, capability, expiry, one-time exchange, replay ID, revocation, and safe
browser delivery.

Reuse the policy shape and test discipline, not the agent token implementation.

### 3. Give model C a stable anonymous subject

A display name cannot own durable notes. A pseudonymous participant needs a
random stable subject scoped to the embed, with display name as mutable
presentation only. Own-note update/delete rules must reference that subject.

### 4. Reuse the read-only renderer, not the public-share bearer URL

FE-A should introduce `CanvasEmbed` rather than frame `/share/[token]` directly.
The public share token grants access and is likely to leak in copied iframe URLs,
logs, screenshots, or referrers. Reuse the existing read-only components and API
query logic behind a distinct revocable embed configuration. IMP-033 remains a
prerequisite for public links, but embeds should not inherit public-link identity.

### 5. Separate framing, CORS, and messaging

An iframe navigation does not need CORS. `frame-ancestors` controls who may
frame the embed; CORS controls script/API reads; `postMessage` controls parent/
child communication. The current global wildcard-subdomain CORS support is not
a substitute for stored per-embed exact ancestor origins. Wildcards should not
be the default for widgets.

### 6. Narrow the prerequisite gates by release

IMP-004 and IMP-033 plus bounded reads are enough to begin a non-live read-only
widget. IMP-006 is a hard gate only when WebSockets or contributor sessions are
introduced. Write mode additionally needs IMP-007, IMP-008, IMP-017, and
IMP-018. This allows a safe useful release without waiting for every
collaboration improvement.

### 7. A client registry is not required for Memoria-account consent

A `CanvasEmbed` registry is always required. A confidential
`EmbedIntegration` client registry is required for `B1`, where the host server
asserts its own users. Model `A` can instead use a top-level Memoria login and
canvas-scoped consent flow, returning a one-time code to the iframe. It does not
need the host to hold a client secret.

## Adjustments to the Codex proposal

### 1. Defer unused identity tables

The Codex proposal introduces `EmbedIntegration`, `ExternalIdentity`, and
`EmbedSession` together. Release `R` needs only `CanvasEmbed`. Add integration
and external-identity records when `B1` is selected. Avoid a speculative schema
that supports every future identity mode before one is needed.

### 2. Use a two-stage session mechanism

Persist a hashed, single-use, short-expiry exchange code when a browser handoff
is required. Exchange it for a very short-lived signed widget ticket containing
embed, canvas, participant, capability, origin, audience, expiry, and `jti`.
Persist revocation/high-value audit state, not every high-volume request or
heartbeat as an `EmbedSession` row.

### 3. Make the first write mode note-only

`CONTRIBUTE` should initially allow plain-text note creation, update/delete of
one's own notes, and optionally comments. Use server-assigned safe placement or
a designated contribution region. Exclude images, arbitrary rich text, links,
polls, uploads, AI, sharing, templates, history, and canvas settings until each
has an explicit capability and quota model.

### 4. Do not require live sockets for release R

A read-only widget can use a bounded initial response and conservative refresh
or manual reload. This avoids making IMP-006/017 blockers for the first release.
Add committed delta events only when “live” behavior or writing becomes part of
the contract.

### 5. Reduce the initial SDK surface

Ship a documented iframe snippet first. The first `postMessage` contract needs
only `ready`, `resize`, optional theme, one-time session delivery, and a small
error/status event. Defer a custom element, npm package, event subscriptions,
and headless API until multiple integrations prove the interface.

### 6. Treat estimates as ranges after prerequisite audit

The indicative estimates are useful for scale, but actual effort depends on how
much of IMP-004/006/017/024 has landed. Re-estimate each promoted release from
the then-current tree rather than treating the original range as a commitment.

### 7. Make quota attribution explicit

Widget storage and item counts should charge the canvas owner. `B1` should also
have integration traffic/session limits so one partner cannot consume the
owner's full service budget. AI remains unavailable in widgets by default; it
requires an explicit owner budget and per-integration authorization later.

## Adjusted combined plan

### Gate 0 — choose the product boundary

Before promotion, decide:

1. Initial embed operators: only the Memoria owner/operator's exact origins, or
   registered third parties?
2. First interactive identity: pseudonymous room participant (`C`) or signed
   host user (`B1`)?
3. First write scope: note-only own-item operations is recommended.
4. Live promise: no live contract for release R; committed deltas for writes.
5. Quota payer: canvas owner for storage/items, plus integration traffic caps;
   AI off by default.

Recommended choices are operator-configured exact origins, release R first,
note-only C second, and B1 third for products that already authenticate users.

### FE-01 — embed resource and framing boundary

Add `CanvasEmbed` with opaque ID, canvas, `VIEW` mode, exact allowed origins,
status/revocation, and bounded presentation settings. Add owner create/list/
update/revoke controls. Generate a dedicated `/embed/[embedId]` response whose
CSP `frame-ancestors` is derived from that record and whose X-Frame-Options is
omitted. All other routes retain `DENY` and `frame-ancestors 'none'`.

Do not put a bearer secret in the iframe URL for public read-only mode; treat the
embed ID as a public identifier constrained by mode, origin policy, rate limits,
and revocation.

Prerequisites: IMP-004, IMP-033, and either IMP-024 or a temporary hard widget
item/response limit.

### FE-02 — bounded read-only viewer

Reuse read-only canvas rendering behind a compact responsive shell. Return only
the bounded viewport/summary data required by the embed. Include loading,
unavailable, revoked, and reduced-motion/accessibility states. Ship a plain
iframe snippet and integration tests for allowed/disallowed ancestors, revoke,
cache, mobile sizing, and oversized canvases.

No WebSocket and no parent identity are required.

### FE-03 — widget credential and ticket core

Create one policy vocabulary for embed capabilities and one short-lived ticket
validator shared by HTTP and WebSocket boundaries. Add one-time exchange codes
only for authenticated handoffs. Tickets carry explicit audience, origin,
canvas, embed, participant, capabilities, expiry, and replay ID. Add key
rotation, revocation horizon, safe logs, and clock-skew tests.

Prerequisites: IMP-006 and IMP-004.

### FE-04 — pseudonymous note contributors

Add an embed-scoped random participant subject and display name. Support only
create note, update own note, delete own note, view, and optionally comment.
Mark contribution provenance and owner subject on each created record. Enforce
server placement/geometry bounds, per-participant and per-embed limits, content
size, and committed delta synchronization.

Prerequisites: FE-03 plus IMP-007, IMP-008, IMP-017, and IMP-018.

### FE-05 — moderation and operational controls

Add owner moderation for remove, mute/ban participant, pause contributions,
rotate/revoke access, audit provenance, and view usage. Add global, owner,
integration, embed, participant, and trusted-IP budgets. Test reconnect,
concurrency, spam, revocation, process restart, and owner recovery.

FE-04 should not be publicly advertised before FE-05 ships.

### FE-06A — existing Memoria-account consent

Use a top-level popup/redirect so Memoria authentication is first-party. Ask for
canvas/embed capabilities explicitly, create a one-time code, and deliver it to
the validated iframe origin. Do not expose the user's normal Memoria session to
the parent app.

This branch is optional and independent of host-account integration.

### FE-06B — signed host-account integration

Add `EmbedIntegration` with client ID, hashed/rotatable secret, exact issuer and
origins, allowed embeds/canvases, status, and quotas. The host server exchanges
`(issuer, subject, display metadata, requested embed)` for a one-time browser
code. Store an `ExternalIdentity` only when stable cross-session ownership is
needed. Never trust browser-submitted issuer/subject values.

This is the recommended account-linking model for the user's other authenticated
projects and does not require full Memoria user provisioning.

### FE-07 — convenience SDK, then optional federation

After at least two real integrations stabilize the contract, wrap the iframe in
a small web component and version the minimal `postMessage` protocol. Consider
OAuth/OIDC discovery or headless APIs only if arbitrary third-party/self-hosted
federation becomes a deliberate product direction.

## Proposed promotion cards

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| FE-01 | Revocable embed resource and per-route framing | IMP-004, IMP-033 |
| FE-02 | Bounded read-only iframe viewer | FE-01, IMP-024 or temporary cap |
| FE-03 | Scoped widget exchange and tickets | FE-01, IMP-006 |
| FE-04 | Own-note pseudonymous contribution | FE-03, IMP-007/008/017/018 |
| FE-05 | Moderation, provenance, and abuse budgets | FE-04 |
| FE-06A | Memoria-account consent | FE-03 |
| FE-06B | Host issuer/subject integration | FE-03, FE-05 |
| FE-07 | Thin embed SDK | Two proven integrations |

When promoted, convert only the selected next FE row into a normal `IMP-` task.
Do not copy this whole expansion into the live Kanban.

## Housekeeping adjustment

`future-expansion/README.md` currently links to the deleted
`embeddable-canvases.md`. Once the user accepts this synthesis, point that index
to `FE-roundtable.md` and retain the Codex/Opus files as review inputs until the
first release is promoted.

---

# Opus review — round 2

Reviews the Codex proposal and the synthesis above. Verified against the current
schema; line references are current as of this commit.

## Accepted from the synthesis

All seven adjustments to the Opus proposal are correct and I withdraw the
originals. Three deserve stronger language than the synthesis gives them.

| # | Adjustment | Note |
| - | ---------- | ---- |
| 1 | Split B into B1/B2 | Correct. B1 needs no billing or tenant workspace. |
| 2 | Don't reuse agent tokens as browser credentials | Correct, and my "80% of the shape" was too generous — a server-held long-lived Argon2 token shares almost nothing with a browser credential beyond the scoping predicate. |
| 3 | Model C needs a stable subject | Correct. "Display names, no account" cannot own a note. |
| 4 | Don't frame `/share/[token]` | **The sharpest catch against me.** My FE-A proposed putting a bearer secret in a URL that gets pasted into third-party HTML, logged as a referrer, and screenshotted. That was a security regression, not a shortcut. |
| 5 | Separate framing / CORS / postMessage | Correct. Citing wildcard-subdomain CORS as an asset was misleading; iframe navigation does not consult CORS. |
| 6 | Gate prerequisites per release | Correct and better than either original. A non-live read-only widget genuinely does not need IMP-006. |
| 7 | Registry not needed for model A | Correct. My FE-C → FE-D chain was wrong. |

## Still missing from both documents

### 1. Guest writes are blocked by the schema, not by auth

This is the largest omission and it changes FE-04's cost class.

- `CanvasItem.createdById` — non-nullable, required `User` relation, no
  `onDelete` rule (`prisma/schema.prisma:148-151`).
- `Comment.userId` — non-nullable, `onDelete: Cascade`
  (`prisma/schema.prisma:176-177`).

No row in this system can be authored by a non-`User`. FE-04 as written ("mark
contribution provenance and owner subject on each created record") implies new
columns but never states that a pseudonymous contributor cannot persist a note
at all until one of these lands:

| Option | Cost | Risk |
| ------ | ---- | ---- |
| Nullable author + `Participant` table | Migration on the two hottest tables; every author read path updated | Collides with IMP-017/IMP-024 surfaces if done concurrently |
| Shadow `User` per external identity | No migration | Pollutes `User`, breaks email-uniqueness assumptions, entangles account-deletion cascades, and `ItemCreatedBy` has no `onDelete` rule to absorb it |

Recommendation: nullable author plus `Participant`. Shadow users are faster to
start and materially worse to live with. Either way this is FE-04 scope and is
currently uncosted in every version of the plan.

### 2. An ephemeral guest identity already exists

`websocket-server.ts:369` mints `guest:${nanoid(10)}` for public canvases, with
no database representation. FE-04 proposes a second, embed-scoped participant
subject without reconciling the two. Pick one participant concept.

### 3. The capability vocabulary does not exist yet

Both documents say "narrower than `EDIT`". `ShareRole` (`prisma/schema.prisma:202`)
has exactly three values — `VIEW | COMMENT | EDIT` — so today the only way to let
a visitor create a note is to also let them edit every other item on the canvas.
The capability set must be *created*, which is precisely IMP-008's job. State
that dependency concretely rather than as a design preference.

### 4. Quota attribution is settled; ceiling behavior is not

The synthesis correctly charges the owner and caps integrations, but not what
happens *at* the ceiling. Recommendation: the embed degrades to read-only and
the owner's canvas stays fully usable. Never break someone's canvas because
their widget got popular. Interacts with DEC-008.

### 5. Guest-contributor privacy is unaddressed

Anonymous visitors leaving content on a third-party site have accepted no one's
terms. Whose privacy policy governs, and how does a pseudonymous participant
request deletion? Self-hosting pushes this onto every operator. FE-04 needs a
retention default; FE-05 needs a documented operator obligation.

### 6. Mid-session revocation is unspecified

What happens to connected participants and in-flight writes when an embed is
revoked, its origin list changes, or the canvas is deleted. Recommendation:
terminate sessions, reject in-flight writes, retain committed contributions.

### 7. IMP-027 is an unlisted prerequisite for FE-06B

`CanvasShare` is keyed on `email` (`prisma/schema.prisma:212`). IMP-027 migrates
shares onto stable user identity — the identical problem external identities
have. Sequencing FE-06B after IMP-027 avoids running two identity migrations
against the same tables.

## Adjustments to the combined plan

| Row | Change |
| --- | ------ |
| FE-04 | Add the author-nullable migration and `Participant` table as explicit scope. Add IMP-008 to prerequisites for the capability vocabulary. Add a contributor-content retention default. |
| FE-05 | Add mid-session revocation semantics and the documented operator privacy obligation. |
| FE-06B | Add IMP-027 as a prerequisite. |
| All | Reconcile with the existing `guest:` identity before adding a second participant concept. |

Otherwise the release structure stands. FE-01 and FE-02 are correctly scoped and
genuinely small.

## One product caveat

FE-01/FE-02 ship a **read-only, non-live** widget. That is the right first
release on risk, but it is not what was originally asked for — "everyone can
leave notes next to the streaming window" is FE-04, behind FE-03, IMP-006,
IMP-007, IMP-008, IMP-017, IMP-018, and the migration above. Worth being explicit
so the first release is understood as a foundation and a demand test, not as the
feature.

If validating the note-taking idea quickly matters more than building the
durable path, that argues for a throwaway prototype on a branch rather than
pulling FE-04 forward — the prerequisite list is real and shortening it means
shipping the widget on top of the weakest boundaries in the system.
