# Embedded canvas widgets

Status: `PARKED` — future expansion, not part of the live Kanban.

## Goal

Let another website or self-hosted application place a Memoria canvas beside
its own UI. Depending on configuration, visitors can view the canvas, leave
notes, or participate as users whose identities come from the host application.

This is the inverse of Memoria's existing `EMBED` canvas item: Memoria itself is
being embedded into another product.

## Feasibility

| Capability | Feasibility | Indicative effort |
|---|---:|---:|
| Read-only iframe | High | 1–2 weeks |
| Guest note contribution | Medium–high | 3–6 weeks |
| Host-account identity linking | Medium | Additional 4–8 weeks |
| Headless rendering SDK | Lower initially | 2–4 months |

Estimates assume one experienced engineer and include security tests.

## Recommended design

Use an iframe as the security and rendering boundary. A small JavaScript/web
component SDK may wrap it later:

```html
<script src="https://memoria.example/embed.js"></script>
<memoria-canvas embed-id="emb_123" theme="dark" height="600"></memoria-canvas>
```

```text
Host application server
  -> integration credential + external user subject
  -> Memoria creates one-time embed session
  -> host page passes short-lived code to Memoria iframe
  -> iframe uses scoped REST and WebSocket access
```

The parent and iframe may exchange only a small, versioned `postMessage`
protocol for ready, resize, theme, session delivery, and safe activity events.
Both sides must validate the exact other origin.

## Embed modes

| Mode | Capability |
|---|---|
| `VIEW` | Read-only widget, comparable to a Discord server widget. |
| `CONTRIBUTE` | Create notes/comments and edit/delete only one's own contributions. |
| `SIGNED_PARTNER` | Same scoped capabilities, with identity asserted by the host application's server. |

Do not map public participants directly to broad `EDIT`. Introduce explicit
capabilities such as `item:create`, `own-item:update`, `own-item:delete`,
`comment:create`, and `canvas:view`.

## Identity and session model

Represent a host user by a stable issuer/subject pair, not email or display name:

```text
issuer  = https://streaming.example
subject = streaming-user-8472
```

Suggested records:

- `CanvasEmbed`: canvas, mode, allowed origins, theme/options, status, revocation.
- `EmbedIntegration`: owner, client ID, hashed secret, issuer, allowed canvases.
- `ExternalIdentity`: integration/issuer, external subject, local participant.
- `EmbedSession`: hashed one-time ID, capabilities, expiry, origin, revocation.

The host server exchanges its integration credential for a single-use browser
code. The iframe exchanges that code for a short-lived session. Do not depend on
third-party cookies or place long-lived bearer credentials in URLs.

For arbitrary self-hosted Memoria instances, start with “create embed and copy
its configuration.” Universal account connection between arbitrary instances
would later require OAuth/OIDC, explicit instance discovery, and SSRF-safe
handling of user-provided instance URLs.

## Security boundary

1. Keep framing denied globally. Only `/embed/[embedId]` receives a dynamic CSP
   `frame-ancestors` allowlist and no `X-Frame-Options: DENY`.
2. Require HTTPS outside development.
3. Validate allowed parent origin during session creation and `postMessage` use.
4. Require a canvas-scoped ticket for WebSocket admission; canvas ID is not a
   credential.
5. Apply participant, integration, embed, canvas, and trusted-IP limits.
6. Bound note size/count and sanitize every supported content type.
7. Provide revoke, rotate, mute/ban, report, moderation, and audit controls.
8. Publish durable item events only after database commit. WebSockets must not
   become an unvalidated write authority.

## Product surface

Create a compact `/embed/[embedId]` experience rather than loading the complete
application shell. It should support responsive sizing, theme, loading/error
states, keyboard access, a DOM item list, connection status, and configurable
branding. Owner settings should show allowed origins, mode, permissions,
integration credentials, active/revoked sessions, usage, and copyable snippets.

## Delivery sequence

### Release 1 — read-only widget

- Add embed configuration and allowed origins.
- Add route-specific framing headers.
- Render a compact read-only canvas with bounded loading.
- Add revoke/rotate controls and iframe integration tests.

### Release 2 — contributed notes

- Add `CONTRIBUTE` capabilities and own-item ownership rules.
- Add one-time guest sessions, scoped WebSocket tickets, committed live updates,
  quotas, and moderation.
- Test concurrent visitors, abuse limits, revocation, reconnect, and recovery.

### Release 3 — partner accounts and SDK

- Add integrations and issuer/subject external identities.
- Add server-to-server session issuance and credential rotation.
- Publish a thin web component SDK and versioned `postMessage` contract.
- Add examples for streaming, events, classrooms, and dashboards.

### Release 4 — optional federation/headless API

- Add OAuth/OIDC authorization between arbitrary self-hosted applications.
- Consider a supported headless API only after embed contracts are stable.

## Existing prerequisites

- [IMP-004](../tasks/IMP-004.md): trusted client identity and rate limits.
- [IMP-006](../tasks/IMP-006.md): WebSocket admission and role boundaries.
- [IMP-007](../tasks/IMP-007.md): lossless autosave and rollback.
- [IMP-008](../tasks/IMP-008.md): explicit capability/geometry contract.
- [IMP-017](../tasks/IMP-017.md): committed item synchronization.
- [IMP-018](../tasks/IMP-018.md): quotas and retention.
- [IMP-022](../tasks/IMP-022.md): accessible responsive canvas.
- [IMP-024](../tasks/IMP-024.md): viewport-first bounded loading.

## Decisions before promotion

- First release: `VIEW` only, or include `CONTRIBUTE`?
- Can anonymous visitors participate, or must the host sign every identity?
- May contributors edit only their own notes, and can owners moderate them?
- Are embeds unbranded, Memoria-branded, or operator-configurable?
- Is support limited to explicitly configured instances, or must arbitrary
  self-hosted instances federate?
- What are the default item, participant, traffic, and session limits?

When these decisions and prerequisites are ready, split each release into small
task cards and add only the selected release to `KANBAN.md`.
