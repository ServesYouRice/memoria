# Maintainability and Code-Quality Issues

## MAINT-01 — Configuration is duplicated across five drifting authorities

- **Severity:** High
- **Location:** `src/lib/env.ts`; `scripts/validate-env.mjs`; `scripts/setup.mjs`; `scripts/doctor.mjs`; `.env.example`; `docker-compose.yml`
- **Description:** Runtime validation, build validation, setup generation, doctor diagnostics, documentation, and container pass-through each maintain separate lists/defaults. They already disagree: the build validator omits `INTERNAL_OPERATIONS_TOKEN`; setup does not rotate it; doctor does not reject its placeholder; Compose drops registration/proxy/rate-limit settings; and the unfurl flag is parsed but unused.
- **Production impact:** A setting can validate in one phase, be reported configured in another, and never reach or affect the production process. Security behavior becomes difficult to review and easy to regress.
- **Recommended fix:** Create one configuration registry/schema with metadata for scope (build/app/worker/scheduler/tooling), secrecy, default, production requirement, placeholder patterns, and documentation. Generate or assert the env template, Compose pass-through, setup/doctor behavior, and build/runtime validation from it.
- **Production blocker:** The current drift is blocking through `SEC-01` and `DEP-01`; the structural cleanup can be incremental once those are fixed.
- **Related risks/dependencies:** `NTH-DX-01`, `TEST-06`.

## MAINT-02 — Release-gated feature code remains active enough to regress the launch UI

- **Severity:** Medium
- **Location:** `src/app/templates/TemplatesContent.tsx`; `src/lib/hooks/use-templates.ts`; template API routes/tests; duplicate handlers and menu items in `src/features/dashboard/components/DashboardContent.tsx`; poll components/hooks
- **Description:** Templates/duplication and poll implementations remain broadly present while server availability functions hard-disable them. The dashboard still compiles and exposes duplicate mutations, and older template tests exercise behavior that production routes now reject before reaching it.
- **Production impact:** Dead/parked code increases bundle/review/test surface and makes it easy for one layer to advertise a capability another layer forbids, as demonstrated by `UI-01`.
- **Recommended fix:** Put gated implementation behind one capability boundary and exclude entry points from the release build/navigation. Keep a small gating contract test in the active suite; move implementation-specific tests with the parked feature or make them opt-in until the feature is promoted.
- **Production blocker:** No beyond the visible-action fix in `UI-01`.
- **Related risks/dependencies:** `NTH-AR-03`.

## MAINT-03 — Response contracts are manually re-declared at consumers

- **Severity:** High
- **Location:** `src/components/StatusSummary.tsx`; `src/app/share/[token]/page.tsx`; `src/app/api/v1/share/[token]/route.ts`; `src/lib/hooks/use-activities.ts`; response schemas under `src/lib/api/`
- **Description:** Some APIs validate output, but key clients use local interfaces or `any` and assume a different structure. The status and public-share failures are direct examples. Pagination fields such as `truncatedByBytes` are optional to consumers rather than encoded as a continuation invariant.
- **Production impact:** Type checking can pass while deployed layers disagree, and local route tests reinforce only one half of the contract.
- **Recommended fix:** Export runtime schemas for each response, infer client types from them, parse at the fetch boundary, and represent pagination as a discriminated contract that cannot claim completion when truncated. Generate fixtures used by both route and component tests.
- **Production blocker:** Yes for the specific broken contracts in `LOG-01`, `LOG-02`, and `UI-02`; the broader migration is not.
- **Related risks/dependencies:** `NTH-DX-02`, `TEST-03`.

## MAINT-04 — Core client modules concentrate too many state and workflow responsibilities

- **Severity:** Medium
- **Location:** `src/features/canvas/components/CanvasBoard.tsx` (over 1,200 lines); `src/features/dashboard/components/DashboardContent.tsx`; `src/app/settings/SettingsContent.tsx`
- **Description:** CanvasBoard coordinates data hydration, viewport state, item mutations, filtering, selection, dialogs, export, collaboration messages, reactions, rendering, and accessibility composition. Dashboard and Settings similarly combine data orchestration with many independent workflows. This makes route-level composition defects and stale state hard to isolate.
- **Production impact:** Small changes have a wide regression radius, focused tests require heavy mocking, and important lifecycle boundaries such as canvas-ID changes are easy to miss.
- **Recommended fix:** Extract cohesive controller hooks and small view regions around stable boundaries—viewport lifecycle, collaboration transport, item-page loading, dialogs, and accessible organizer—while keeping one thin route coordinator. Avoid a wholesale rewrite; move a boundary only when adding its contract test.
- **Production blocker:** No.
- **Related risks/dependencies:** `LOG-04`, `PERF-02`, `UI-04`.

## MAINT-05 — Public documentation and runtime declarations have drifted

- **Severity:** Low
- **Location:** `README.md`; `package.json`; `Dockerfile`; `ARCHITECTURE.md`
- **Description:** README advertises templates and Yjs-oriented collaboration despite templates being release-disabled and durable untrusted Yjs persistence being intentionally absent; it names an older Auth.js beta than the package file. CI, type definitions, and the production image also target different Node major versions.
- **Production impact:** Contributors and operators make incorrect assumptions about enabled features, dependency behavior, and the runtime they must reproduce.
- **Recommended fix:** Generate a compact version/capability table during docs checks, treat package/architecture files as authority, and fail `docs:check` when named versions or release-gated capabilities drift.
- **Production blocker:** No, though launch-facing feature claims should be corrected with `UI-07`.
- **Related risks/dependencies:** `DEP-07`, `NTH-AR-03`.
