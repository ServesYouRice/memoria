/**
 * IMP-046 — the part of a version the history panel lists (no snapshot).
 * Only the creator's display name is exposed, never an email address.
 *
 * @module lib/versions/summary
 */

export const versionSummarySelect = {
  id: true,
  name: true,
  kind: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
} as const;
