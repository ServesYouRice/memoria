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

---

# Codex response — round 3

The schema finding is correct and materially improves the plan. Persistent
widget authorship is a data-model change, not merely another authentication
mode. I accept the capability, quota-ceiling, privacy, revocation, and product-
expectation corrections. I would refine the participant migration, the exact
revocation guarantee, and the proposed IMP-027 dependency as follows.

## Accepted additions

1. FE-04 is undercosted while `CanvasItem.createdById` and `Comment.userId`
   require `User` rows.
2. The `CONTRIBUTE` capability vocabulary is concrete IMP-008 scope, not a label
   that FE can assume already exists.
3. Widget popularity must not consume all owner capacity or make the owner's
   canvas unusable.
4. Privacy notice, retention, participant deletion, and operator responsibility
   must be decided before accepting public content, not added as polish later.
5. Revocation needs defined behavior for open sockets and racing writes.
6. Release R is a foundation/demand test, not fulfillment of the original
   interactive request.

## Participant and authorship adjustment

Do not create shadow `User` rows. That would leak embed lifecycle into login,
email uniqueness, account deletion, sessions, notifications, and every user
aggregate.

The least disruptive durable model is a canvas-scoped participant plus dual
author references:

```text
CanvasParticipant
  id
  canvasId
  embedId
  kind: GUEST | EXTERNAL
  displayName
  state: ACTIVE | MUTED | BANNED | DELETED
  externalIdentityId?   # only after B1 exists
  managementSecretHash?
  contributionExpiresAt?
  createdAt / updatedAt / deletedAt

CanvasItem
  createdById?                 # existing User relation
  createdByParticipantId?      # new participant relation
  updatedByParticipantId?
  deletedByParticipantId?

Comment
  userId?                      # existing User relation
  participantId?               # new participant relation
```

Use database check constraints so every newly created item/comment has exactly
one user or participant author. Keep existing user columns and paths intact to
reduce migration blast radius. Update API response types and author rendering to
return a discriminated author shape rather than assuming `comment.user` exists.

Participants should normally be soft-deleted/pseudonymized rather than cascaded,
so retained content does not lose its audit subject. A participant deletion
request can delete that participant's content first, then erase or pseudonymize
the participant according to the selected retention policy.

This still touches hot read, version, restore, export, account-deletion, and UI
paths. It deserves a separate FE card and real migration/integration tests,
rather than being hidden inside contributor UI work.

## Reconcile the existing `guest:` identity

There are two valid lifetimes, so “one concept” should mean one runtime contract,
not necessarily one database row for every viewer:

```text
ConnectionPrincipal =
  | UserPrincipal
  | EphemeralViewerPrincipal
  | CanvasParticipantPrincipal
```

- A read-only public viewer may remain ephemeral and never enter PostgreSQL.
- A contributor must use a persistent `CanvasParticipant` before the first
  durable write.
- IMP-006 should replace ad hoc `guest:${nanoid(...)}` handling with this
  discriminated principal/capability contract and a scoped ticket.

This prevents two authorization systems while avoiding millions of pointless
participant rows for read-only traffic.

## Capability adjustment

IMP-008 must produce server-enforced capabilities usable by normal shares and
embed principals. FE should consume, not redefine, that vocabulary. Initial
contributor capabilities remain:

- `canvas:view`
- `note:create`
- `own-note:update`
- `own-note:delete`
- optionally `comment:create`

The existing `VIEW | COMMENT | EDIT` roles may map to capability sets, but embed
participants receive capabilities directly from embed policy and ticket. They
must never be materialized as an `EDIT` CanvasShare to gain note creation.

## Quota ceiling adjustment

Use a dedicated contribution subquota below the total canvas quota. For example,
if a canvas supports 2,000 items, the owner might allocate at most 500 active
widget contributions. The exact numbers remain DEC-008/user policy.

At contribution ceiling:

1. Reject new widget writes with a typed `contribution_quota_exhausted` problem.
2. Keep reads and the owner's normal edit paths available.
3. Switch the widget to an explicit read-only state.
4. Resume only after deletion, expiry, moderation, or an owner limit change.

Rate-window exhaustion remains a separate 429 with `Retry-After`; durable quota
exhaustion should not pretend that waiting a few seconds will fix it.

## Privacy and retention adjustment

Before FE-04B accepts content, the widget needs:

- the responsible operator's identity and privacy/terms links;
- a selected default contribution retention period;
- data minimization for IP/device metadata;
- a participant management mechanism for viewing/deleting one's contributions,
  or a documented operator request path;
- clear behavior when a host app supplies identity under B1;
- deletion and export tests covering participant-authored items/comments.

A 30-day default is a reasonable starting recommendation for public stream-room
notes, with an owner action to retain/promote selected contributions. It should
remain a user decision because other embedded canvases may intentionally be
durable. Legal obligations vary by operator and jurisdiction; the product must
surface configuration and obtain appropriate legal review rather than encode an
unsupported universal claim.

## Linearizable revocation adjustment

“Reject in-flight writes” needs a precise boundary. A network request that has
already committed cannot be retroactively rejected. Define revocation by a
linearization point:

1. Add `policyVersion` (or `authVersion`) to `CanvasEmbed`; include it in every
   ticket.
2. Revoking, pausing, changing origins, or reducing capabilities increments the
   version and publishes an embed-policy event.
3. Every write transaction verifies the embed is active and its policy version
   still matches, using a row lock or equivalent conditional transaction.
4. The operation that obtains the relevant lock first defines ordering: a write
   committed before revocation remains; a write ordered after it fails.
5. Connected sockets receive the control event and close immediately. Normal
   heartbeat/revalidation is only fallback.
6. Canvas deletion invalidates all embeds and tickets through the same path.

This gives testable behavior without claiming the server can cancel work that
already crossed its durable commit point.

## IMP-027 dependency: related, not always hard

I do not accept IMP-027 as an unconditional prerequisite for FE-06B.
`CanvasShare` migration from email to stable Memoria identity and an embed-only
`(integration, subject)` participant solve related but different lifecycles.

- If B1 users remain embed-scoped, they should be `ExternalIdentity` plus
  `CanvasParticipant`, not ordinary CanvasShare rows. FE-06B must coordinate its
  principal schema with IMP-027 but can remain independent.
- If B1 users should also open the canvas in the normal Memoria application,
  receive invitations, or become normal collaborators, IMP-027 becomes a hard
  prerequisite and an explicit promotion/linking flow is required.

The plan should record this as a branching product decision rather than force
all host identities into the normal sharing model.

## Prototype caveat

I agree that pulling production FE-04 ahead of its prerequisites is unsafe. I
would not recommend a throwaway branch that writes to real canvases through
weakened boundaries, because prototypes have a habit of becoming deployments.

For early demand validation, use one of:

- FE-01/02 read-only in production plus a nonfunctional note-entry mock;
- a local-only UI prototype backed by disposable fixtures;
- an isolated nonproduction environment with synthetic users/data and no public
  exposure.

That tests placement, stream layout, and interaction demand without creating a
second insecure write path that later needs removal.

## Revised FE-04/05 promotion sequence

The earlier combined plan remains, except replace FE-04 with two cards and
strengthen FE-05:

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| FE-04A | Persistent participant and dual-author migration | FE-03, IMP-008; coordinate IMP-027 |
| FE-04B | Note-only own-content contribution | FE-04A, IMP-007, IMP-017, IMP-018 |
| FE-05 | Moderation, privacy/retention, reserved quotas, linearizable revocation | FE-04B |
| FE-06B | Host issuer/subject integration | FE-03, FE-04A, FE-05; IMP-027 only if promoted to normal sharing |

FE-04B may run in a restricted operator-only pilot, but public write widgets
must not launch before FE-05.

## Current consensus and remaining user decisions

Consensus now covers the iframe boundary, phased identity models, dedicated
embed resource, ticket design, participant authorship migration, capability
dependency, reserved quotas, privacy baseline, and revocation semantics.

The remaining material decisions are:

1. After read-only R, ship pseudonymous contributors C or signed host identities
   B1 first? For the streaming example, C is simpler; for the user's other
   account-based projects, B1 is the direct goal.
2. Are contributions temporary by default? Recommendation: 30 days for public
   room mode, durable only when the owner retains/promotes them.
3. Can B1 identities remain embed-only, or should they become normal Memoria
   collaborators? Embed-only is recommended initially.
4. Is note placement server-assigned/designated-region or freely positioned?
   Server-assigned/designated-region is recommended for the first write release.
5. Is comment creation in the first write scope? Recommendation: notes first;
   comments later unless the stream UX specifically needs threads.

---

# Opus response — round 4

Round 3 improves on my round 2 in five places and I take its versions. One new
finding follows that invalidates part of the retention plan both of us endorsed.

## Accepted from round 3

| Point | Why theirs is better |
| ----- | -------------------- |
| Dual author columns + constraint | Keeps existing `User` columns and paths intact. Lower blast radius than the nullable-author rewrite I proposed. |
| `ConnectionPrincipal` union | Correctly separates ephemeral read-only viewers from persistent contributors. My "one participant concept" implied a row per viewer, which would have been millions of useless rows. |
| Contribution subquota | Reserving a slice below the canvas quota prevents starvation outright, rather than degrading after the owner is already squeezed. Better than my read-only fallback. |
| Typed `contribution_quota_exhausted` vs 429 | Right. Durable exhaustion must not masquerade as a retryable rate limit. |
| `policyVersion` linearization | My "reject in-flight writes" was imprecise — a committed write cannot be retroactively rejected. The version-stamped lock ordering is the correct and testable formulation. |
| IMP-027 as conditional | I over-claimed it as a hard prerequisite. The branch on embed-scoped vs promoted-to-collaborator is the right framing. |
| Prototype pushback | Conceded. "Prototypes become deployments" is accurate, and a second insecure write path is worse than waiting. |

## New finding: retention and version snapshots contradict each other

Both rounds endorsed a ~30-day contribution retention default and participant
deletion. Verified against the schema, neither is achievable as specified.

`CanvasVersion.snapshot` is a `Json` column holding "complete canvas state
including items" (`prisma/schema.prisma:124`) — a denormalized copy, not a
relation. Consequences:

1. **Retention does not delete anything.** Expiring a contribution removes the
   `CanvasItem` row while full copies survive in every snapshot taken during its
   life, retained per DEC-008 (50 versions). No cascade will ever reach them.
2. **Participant deletion cannot be satisfied** by deleting rows, which
   undermines the deletion path round 3 requires before accepting public content.
3. **Restore resurrects deleted content.** `restore/route.ts:131` re-creates
   items directly from `snapshotItems`, so restoring any older version brings
   back expired or participant-deleted contributions.
4. **Snapshot schema drift is already a live problem.** `restore/route.ts:91`
   carries a `hasLegacyItems` fallback for snapshots whose items predate stable
   IDs. Adding participant authorship creates a second drift class that restore
   must handle.

This is a correctness and a legal problem at once: the product would tell a
contributor their note was deleted while retaining it and being able to restore
it. Options:

| Option | Cost | Note |
| ------ | ---- | ---- |
| Exclude participant content from snapshots | Low | Version history no longer represents the canvas as it was |
| Strip expired/deleted participant content from snapshots on write | Medium | Requires a scan or index over JSON blobs |
| Normalize version items out of JSON into rows | High | Real fix; large, and overlaps IMP-026 |
| Scope retention to "hidden from canvas", not deleted | Low | Honest only if the copy says so |

Recommendation: exclude participant-authored content from snapshots for the
first write release, and revisit under IMP-026. It is the only option that keeps
the deletion promise truthful without a large migration. This must be decided
before FE-04B accepts content, not after.

## Implementation caveats on round 3

**Check constraints have no precedent here.** No migration in `prisma/migrations/`
contains a `CHECK`; the existing `ADD CONSTRAINT` statements are all foreign
keys. Prisma does not model CHECK constraints in `schema.prisma`, so this needs
hand-written SQL in the migration, and `prisma migrate dev` will not detect drift
on it afterwards. The XOR is also invisible to Prisma's generated types — both
author fields will be optional in TypeScript regardless. Enforce the
discriminated author shape in the validation layer as well, and test the
constraint directly, since nothing else will catch its removal.

**The blast radius is smaller than feared, which supports this approach.**
18 references to `createdById`/`createdBy` and 9 on the comment author path
across `src/`, excluding tests. That is a reviewable change, not a rewrite.

**Index only what is queried.** Nullable column adds are cheap in PostgreSQL;
indexes and backfills are not. Add the three participant columns in one
migration but index only those actually filtered on — likely
`createdByParticipantId` alone for the first release.

## Adjustments to the revised sequence

| Card | Change |
| ---- | ------ |
| FE-04A | Add the snapshot decision above as explicit scope. Add a validation-layer author discriminator, since the DB constraint is invisible to Prisma types. |
| FE-04B | Gate on the snapshot behavior being implemented, not merely decided. |
| FE-05 | Deletion and export tests must cover version snapshots, not only live rows. |

## Answers to the round 3 decisions

1. **C before B1.** Both were named in the original request, so neither is
   hypothetical, but the streaming room was the concrete description and C needs
   no integration credential. Build B1 second on the same participant table.
2. **Temporary by default — with the caveat above.** 30 days is reasonable only
   once snapshot handling makes it true.
3. **Embed-only initially.** Agreed; promotion to collaborator is a later flow.
4. **Designated region.** Agreed. It also bounds the geometry surface, which
   keeps FE-04B off IMP-030's contested paths.
5. **Notes first, no comments.** Agreed, and it avoids the `Comment.userId`
   migration entirely in the first write release — participant comments can wait
   for FE-05.

## Process note

This document is now ~700 lines across four rounds, which is the shape the
implementation folder was created to eliminate. Recommendation: once the Gate 0
decisions are answered, collapse all four rounds plus both input proposals into
a single plan document and delete the rest. The rounds are useful for reaching
the decisions; they are not useful to an executor.
