Title: Performance Budgets and CI Guard
Date: 2025-11-09
Status: Accepted
Owners: CodexCLI

## Context

Memoria's canvas experience can pull in large client-side dependencies. Bundle
growth should be visible before it affects first-load and interaction
performance.

## Decision

Track route-level JavaScript bundle budgets and keep the bundle checker script
available for local and CI use.

Target budgets:

- landing route: less than 100 KB gzipped JavaScript;
- auth routes: less than 125 KB gzipped JavaScript;
- canvas shell: less than 150 KB gzipped JavaScript, with heavy canvas libraries
  lazy-loaded where possible.

## Current Implementation Status

- `scripts/check-bundle-size.mjs` exists.
- `pnpm check-bundle` runs the checker.
- The current GitHub Actions workflow does not run the checker as a required
  gate.
- Vitest coverage reports are available, but coverage thresholds are not
  configured in `vitest.config.ts`.

## Consequences

Positive:

- The project has explicit budget targets and a script for measuring them.
- The checker can be wired into CI when the team is ready to enforce budgets.

Negative:

- Until CI enforcement is enabled, regressions depend on developers running the
  checker manually.

## References

- `scripts/check-bundle-size.mjs`
- `package.json`
- `docs/TESTING_GUIDE.md`
