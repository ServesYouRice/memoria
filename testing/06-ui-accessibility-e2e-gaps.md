# 06 — UI, Accessibility (a11y) & End-to-End (E2E) Testing Gaps

## Domain Overview & Architecture

Memoria's frontend interface is built with **Next.js 16 (App Router)**, **React 19**, **Konva / React-Konva** (for canvas rendering), **MUI / Emotion** (for controls), and **Zustand** (for canvas UI state).
End-to-End testing is powered by **Playwright**, with **Percy** for visual regressions.

```
Playwright Browser Test Runner
   ├── Desktop Chrome / Firefox / WebKit (Desktop 1280x720)
   ├── Missing: Mobile Chrome / Mobile Safari (320px, 375px, 768px)
   ├── Missing: Automated Axe-core Accessibility Audits
   └── Disabled in CI: tests/e2e/visual/** (Percy Visual Specs)
```

---

## Detailed Testing Gaps & Audit Findings

### GAP-UI-01: Visual Regression Suite Excluded from Default CI Pipeline (`TEST-05`)
- **Severity**: **High**
- **Affected Files**: `playwright.config.ts`, `.github/workflows/ci.yml`
- **Defect Description**: `playwright.config.ts` explicitly sets `testIgnore: "visual/**"`. Consequently, Percy visual specs are never executed during normal CI runs or pre-commit checks, allowing unintended layout shifts, theme contrast bugs, and responsive CSS regressions to ship silently.
- **Current Test Gap**: Visual tests under `tests/e2e/visual/` require a manual Percy token and are never asserted against baseline screenshots in PR workflows.
- **Invariant Requirement**: High-leverage static pages (Dashboard, Login, Setup, Share page, Canvas Toolbar) must have deterministic local screenshot tests or automated CI visual regression gates.

### GAP-UI-02: Missing Mobile & Touch Viewport Matrix Testing
- **Severity**: **High**
- **Affected Files**: `playwright.config.ts`, `src/features/canvas/components/CanvasBoard.tsx`, `src/features/canvas/components/MainToolbar.tsx`
- **Defect Description**: Playwright projects only test desktop browsers (Chrome, Firefox, Safari). There is zero test coverage for mobile viewports (320px iPhone SE, 375px, 768px tablet) or touch gestures (pinch-to-zoom, two-finger pan). On small screens, toolbar menus can overlap the canvas board or overflow outside the screen boundaries.
- **Current Test Gap**: `tests/e2e/*.spec.ts` only runs at default desktop viewport sizes; no mobile device profiles (`devices['Pixel 7']`, `devices['iPhone 14']`) are registered in test runs.
- **Invariant Requirement**: Playwright suite must include mobile browser projects verifying responsive toolbar collapsing, sheet drawer rendering, and touch panning without horizontal overflow.

### GAP-UI-03: Canvas Search Deletes Visual Items from Render Tree (`UI-05`)
- **Severity**: **High**
- **Affected Files**: `src/features/canvas/components/CanvasBoard.tsx`, `src/features/canvas/hooks/use-canvas-data.ts`
- **Defect Description**: When a user types a query into canvas search, non-matching items (such as frames, shapes, arrows, and unannotated drawings) are filtered out of the render tree completely, breaking structural spatial context rather than dimming non-matching elements.
- **Current Test Gap**: Unit tests for search only check text substring matching in memory; no component test verifies that non-matching items remain in the DOM with reduced opacity.
- **Invariant Requirement**: Canvas search must retain all spatial elements in the canvas layer, applying a dimmed visual filter (`opacity: 0.2`) to non-matching items rather than removing them from the Konva stage.

### GAP-UI-04: Lack of Automated Axe Accessibility & Screen Reader Gates
- **Severity**: **Medium**
- **Affected Files**: `src/features/canvas/components/CanvasAccessiblePanel.tsx`, `src/components/CommandPalette.tsx`
- **Defect Description**: While `CanvasAccessiblePanel.tsx` provides a screen-reader list view, there are no automated `@axe-core/playwright` audits to assert zero WCAG 2.1 AA violations on color contrast, aria-labels on icon buttons, modal focus traps, and aria-live announcements for collaborator actions.
- **Current Test Gap**: `tests/unit/canvas-accessibility.test.tsx` only checks shallow DOM renders of the accessibility panel without full-page axe audits or focus management assertions.
- **Invariant Requirement**: All primary pages (Dashboard, Canvas, Auth, Settings, Modals) must pass automated `axe.run()` audits with 0 critical or serious violations.

### GAP-UI-05: PWA Service Worker Cache Invalidation & Offline Updates
- **Severity**: **Medium**
- **Affected Files**: `public/sw.js`, `src/components/PWARegister.tsx`, `src/app/offline/page.tsx`
- **Defect Description**: When a new release deploys with updated JavaScript chunk hashes, the service worker must properly skip waiting, invalidate old caches, and present an "Update Available" notification without serving stale, broken scripts.
- **Current Test Gap**: No automated E2E test installs the service worker, updates the service worker script, and verifies cache invalidation.
- **Invariant Requirement**: Service worker update events must trigger clean cache rotation and prompt users to refresh if assets are version-bumped.

---

## Actionable Test Implementation Matrix

| Test ID | Scope | Target File | Test Strategy | Target Model |
| --- | --- | --- | --- | --- |
| `TEST-UI-01` | E2E / Visual | `tests/e2e/visual-baselines.spec.ts` | Capture screenshot snapshots across desktop & mobile viewports | Sonnet + Haiku |
| `TEST-UI-02` | E2E / Mobile | `tests/e2e/mobile-canvas-viewport.spec.ts` | Test canvas panning and toolbar drawer at 320px and 375px | Sonnet |
| `TEST-UI-03` | Component | `tests/unit/canvas-search-dimming.test.tsx` | Assert non-matching shapes remain rendered with dimmed opacity | Sonnet |
| `TEST-UI-04` | E2E / A11y | `tests/e2e/accessibility-axe.spec.ts` | Run axe-core audits across Dashboard, Canvas, and Dialogs | Sonnet |
| `TEST-UI-05` | E2E | `tests/e2e/service-worker-update.spec.ts` | Simulate PWA install and service worker cache update lifecycle | Sonnet |

---

## Advisor-Executor Prompt Specification

```xml
<test_specification domain="ui_accessibility_e2e">
  <context>
    Memoria frontend is built with React 19, Konva canvas, and MUI components. E2E uses Playwright.
  </context>
  <task>
    Author Playwright E2E tests for mobile viewports, automated axe accessibility audits, and canvas search dimming behavior.
  </task>
  <invariants>
    1. Running axe-core against Canvas, Dashboard, and Auth flows must produce 0 critical or serious accessibility violations.
    2. Mobile viewports (320px, 375px) must not exhibit horizontal overflow outside the viewport bounding rect.
    3. Canvas search filtering must preserve non-text canvas items with dimmed opacity rather than unmounting them.
  </invariants>
  <verification>
    pnpm test:e2e tests/e2e/mobile-canvas-viewport.spec.ts tests/e2e/accessibility-axe.spec.ts
  </verification>
</test_specification>
```
