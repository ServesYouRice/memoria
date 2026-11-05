/** IMP-069 output kinds; client-safe (no server imports). */
export const PILE_TRANSFORM_KINDS = ["summary", "checklist", "table"] as const;
export type PileTransformKind = (typeof PILE_TRANSFORM_KINDS)[number];
