# Audit Remediation Plan

## Audit summary

The audit identifies 178 findings across security, correctness, operations,
performance, UI/accessibility, and test maintainability. The current baseline
passes lint, TypeScript, and 207 unit tests, but the supported production build
is blocked by divergent environment validation and several release-critical
trust-boundary, storage, collaboration, and deployment defects remain.

This pass treats the stable audit IDs in `audits-notes/` as the checklist. Work
is ordered by exploitability and data integrity first, then production
operability, core interaction correctness, performance, accessible surfaces,
and regression coverage.

## Missing surfaces

| Feature already implemented | Missing page or surface | Fix |
|---|---|---|
| Service worker / installable PWA | Offline fallback | Add a public offline document and restrict the service worker to explicit public assets. |
| Analytics, AI, camera, uploads, account deletion | Privacy and terms information | Add public privacy/terms pages and link them from auth/setup/application chrome. |
| Keyboard shortcuts, sharing roles, retention, experiments | In-app help | Add a reachable help surface backed by current source-of-truth shortcut and policy data. |
| Environment and integration readiness checks | User-facing status/setup guidance | Add a protected status/setup surface without leaking operational secrets. |
| Email-address canvas sharing | Invite acceptance/notification flow | Add an explicit invitation state and recipient workflow instead of implicit discovery. |
| Soft-deleted canvas items and versions | Trash/recovery | Add owner-only listing, restore, retention, and permanent-delete controls. |
| Canvas rendered through Konva | Keyboard/screen-reader equivalent | Add a synchronized semantic item outline with selection and permitted actions. |

## Modernization and remediation list

- Replace cache-all service-worker behavior with an explicit, build-versioned
  public asset allowlist and network-only handling for private/API/navigation
  requests.
- Replace unscoped collaboration persistence with canvas-scoped, validated,
  server-attributed writes and bounded protocol messages.
- Replace automatic webhook redirects with manually validated, bounded hops;
  require same-origin relative integration paths and bounded response capture.
- Replace process-local/spoofable trust decisions with shared validation,
  trusted-proxy identity rules, bounded rate-limit keys, and explicit endpoint
  budgets.
- Replace retry-by-default mutations with non-retrying side effects or stable
  idempotency keys bound to a canonical request-body hash.
- Replace uncontrolled pan/viewport state and fixed viewport measurements with
  controlled stage state, measured containers, dynamic viewport units, and
  safe-area-aware sizing.
- Replace visible no-op or misleading controls with implemented, permission-aware
  behavior or remove them until available.
- Replace pointer-only and unnamed controls with semantic buttons, explicit
  accessible names, dialog/popover focus behavior, and reduced-motion support.
- Replace hard-coded light canvas colors with light/dark theme tokens and use
  responsive grouping for the canvas toolbar.
- Replace first-page-only lists with accessible cursor/infinite loading where
  APIs already expose pagination.
- Replace broad/unbounded database and upload reads with selected fields,
  pagination, byte/dimension limits, streaming where practical, and lifecycle
  ownership.
- Replace divergent build/setup/runtime configuration with one conditional
  schema, generated secrets, hermetic self-host builds, non-root runtime,
  migrations, readiness, graceful shutdown, and backup/restore automation.
- Replace fragmented test setup and stale fake-auth E2E cases with explicit unit,
  integration, protocol, accessibility, service-worker, and production smoke
  suites.

## Order of work

1. Plan and preserve baseline evidence.
2. Release blockers: security, data integrity, dependency graph, service worker,
   uploads, webhooks, suggestion execution, environment/setup/container path.
3. Collaboration and canvas correctness: write authority, permissions, pan/zoom,
   retry/idempotency, errors, and visible incomplete controls.
4. Performance and scalability: duplicate/unbounded data paths, pagination,
   upload/search/AI budgets, viewport loading, bundle budgets, and hot components.
5. Pages and accessibility surfaces: offline, policies/help/status/invites/trash,
   semantic canvas outline, responsive controls, focus, names, theme, and motion.
6. Tests and maintainability: consolidate setup, type boundaries, route/error
   contracts, real integration/E2E fixtures, CI policy gates, and documentation.
7. Remove this temporary plan after its durable outcomes and verification are
   recorded in project documentation.

## Verification plan

- `pnpm run lint`
- `pnpm run type-check`
- `pnpm exec prisma validate`
- `pnpm exec vitest run`
- targeted integration/protocol/service-worker regression suites
- `pnpm audit --prod` against the release policy
- clean production `pnpm run build` and corrected bundle budget check
- Playwright core flows, authorization matrices, and accessibility checks
- clean Docker Compose build/start/migrate/bootstrap/upload/share/restart/
  shutdown/backup/restore smoke path
- screenshot review at 320, 375, 768, 1024, and desktop widths, light/dark,
  200% zoom, new pages, permission modes, and open dialogs

