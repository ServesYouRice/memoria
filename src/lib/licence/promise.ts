/**
 * IMP-112: the licence Memoria is published under, and the features the
 * owner promises will always stay free (DEC-017, 2026-11-11). The README,
 * the Help page and `package.json` say the same; a test keeps them in step.
 */

/** SPDX id of the licence in `LICENSE`. */
export const MEMORIA_LICENCE = "AGPL-3.0-only";

export const MEMORIA_LICENCE_NAME = "GNU Affero General Public License v3.0";

/** Features that will never be put behind a payment. */
export const ALWAYS_FREE = [
  "Running Memoria on your own server",
  "Passkeys and two-step codes",
  "Exporting everything you made",
  "AI on your own key",
] as const;
