/**
 * Optional product-surface semantics (IMP-032, DEC-011 through DEC-013).
 *
 * These surfaces were shipped promising more than the product implements. This
 * module is the single client-safe declaration of what each one actually does,
 * so components, copy, and help text cannot drift apart.
 *
 * @module lib/product-surfaces
 */

/**
 * DEC-011 — embeds are link previews. Nothing third-party executes: the canvas
 * renders a static card and the CSP keeps `frame-src` at `'none'`.
 */
export const EMBED_SURFACE_MODE = "link-preview" as const;

/** Copy shown on embed items so the card never implies live content. */
export const EMBED_PREVIEW_LABEL = "Link preview";

/**
 * IMP-105 (replaces DEC-012) — the meeting timer is shared: everyone on the
 * canvas sees the same countdown, and only editors control it. It is a
 * short-lived signal, never saved, and it ends when the last person leaves.
 */
export const MEETING_TIMER_SCOPE = "shared" as const;

/** Copy shown wherever the timer appears. */
export const MEETING_TIMER_DISCLOSURE =
  "Shared timer — everyone on this canvas sees the same countdown.";

/** Shown to people who can see the timer but not control it. */
export const MEETING_TIMER_VIEWER_NOTE =
  "Only people who can edit this canvas can start or stop it.";

/**
 * Launch feature registry (IMP-046).
 *
 * Keep this object client-safe: both route guards and visible UI import it, so
 * a deliberately disabled backend can never retain a matching launch control.
 * Item duplication is intentionally not listed here; it is a supported canvas
 * item write, unlike whole-canvas duplication.
 */
export const LAUNCH_CAPABILITIES = Object.freeze({
  templates: true,
  canvasDuplication: true,
  polls: true,
});

export type LaunchCapability = keyof typeof LAUNCH_CAPABILITIES;

export function isLaunchCapabilityEnabled(
  capability: LaunchCapability,
): boolean {
  return LAUNCH_CAPABILITIES[capability];
}

/**
 * DEC-013 — the AR canvas layer stays off until the real-device/browser matrix
 * passes. It is opt-in per deployment and labelled experimental when enabled.
 */
export function isArCanvasEnabled(): boolean {
  // Literal member access so Next can inline the value at build time.
  return process.env.NEXT_PUBLIC_ENABLE_AR_CANVAS === "true";
}

/** Copy shown when the AR layer is enabled. */
export const AR_EXPERIMENTAL_DISCLOSURE =
  "Experimental — camera support is unverified on this device. Video stays on your device and is never uploaded.";

/** Host label for an embed URL, falling back to the raw value when unparseable. */
export function describeEmbedTarget(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
