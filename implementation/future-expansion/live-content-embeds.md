# Live external-content embeds

Status: `PARKED`. Not on the live Kanban and not executable. Link previews are
the launch behavior selected by DEC-011. Promote only a narrowly scoped card
after the decisions and safeguards below are settled.

This proposal covers external content displayed inside a Memoria canvas item.
It is distinct from `embeddable-canvases.md`, where another application displays
a Memoria canvas.

## Goal

Let a canvas owner deliberately upgrade a safe link preview into interactive
third-party content without allowing arbitrary pages to execute with Memoria's
origin, credentials, or permissions.

## Existing foundation

- Link previews and unfurling provide a useful non-executable fallback.
- SSRF protections constrain server-side metadata fetching.
- Content Security Policy and security headers already define a restrictive
  application boundary.

## Decisions required before promotion

1. Start with an explicit provider allowlist or support arbitrary URLs.
2. Decide which providers may set cookies, track users, or require sign-in.
3. Define consent behavior before third-party content loads.
4. Define sandbox permissions per provider; never use a blanket permissive
   iframe policy.
5. Choose accessibility requirements and a keyboard-accessible preview fallback.
6. Define failure, offline, export, and deleted-provider behavior.
7. Decide whether embeds are permitted on public/shared canvases.

## Non-negotiable boundaries

- Render third-party content in a sandboxed cross-origin iframe.
- Derive `frame-src` from a server-owned provider registry, not item input.
- Do not forward Memoria sessions, API keys, or authorization headers.
- Keep the static link preview available before consent and whenever an embed
  fails or is unsupported.
- Validate provider IDs and canonical URLs on durable writes; UI checks are not
  a security boundary.
- Make active embeds opt-in per item and revocable by the canvas owner.

## Candidate cards if promoted

| Card | Scope | Depends on |
| ---- | ----- | ---------- |
| FE-LIVE-01 | Provider registry, canonical URL validation, sandbox/CSP policy, and security tests | Provider and privacy decisions |
| FE-LIVE-02 | Consent-aware embed item API with static-preview fallback and public-share policy | FE-LIVE-01 |
| FE-LIVE-03 | Accessible interactive renderer, failure states, and production browser tests | FE-LIVE-02 |

Promote one card at a time. Do not place the full proposal on the live Kanban.
