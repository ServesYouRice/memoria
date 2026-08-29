// @vitest-environment happy-dom
/**
 * IMP-032 — optional product-surface semantics (DEC-011 through DEC-013).
 *
 * Each surface must present only what the product implements: embeds are inert
 * link previews, the timer is personal, and the AR layer stays off unless a
 * deployment opts in.
 */

import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCSP } from "@/middleware/csp";
import {
  AR_EXPERIMENTAL_DISCLOSURE,
  EMBED_PREVIEW_LABEL,
  EMBED_SURFACE_MODE,
  MEETING_TIMER_DISCLOSURE,
  MEETING_TIMER_SCOPE,
  describeEmbedTarget,
  isArCanvasEnabled,
} from "@/lib/product-surfaces";
import { MeetingTimer } from "@/features/canvas/components/MeetingTimer";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("DEC-011 embeds are link previews, never live frames", () => {
  it("declares the link-preview mode", () => {
    expect(EMBED_SURFACE_MODE).toBe("link-preview");
    expect(EMBED_PREVIEW_LABEL).toMatch(/link preview/i);
  });

  it("keeps third-party framing blocked by the CSP", () => {
    const csp = buildCSP("test-nonce");

    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("describes the target host without fetching it", () => {
    expect(describeEmbedTarget("https://www.youtube.com/watch?v=abc")).toBe(
      "youtube.com",
    );
    expect(describeEmbedTarget("https://figma.com/file/1")).toBe("figma.com");
  });

  it("falls back to the raw value for an unparseable URL", () => {
    expect(describeEmbedTarget("not a url")).toBe("not a url");
  });
});

describe("DEC-012 the meeting timer is personal UI", () => {
  it("declares personal scope", () => {
    expect(MEETING_TIMER_SCOPE).toBe("personal");
    expect(MEETING_TIMER_DISCLOSURE).toMatch(/not shared with collaborators/i);
  });

  it("labels the control as personal rather than shared", () => {
    render(<MeetingTimer />);

    const trigger = screen.getByRole("button", {
      name: /personal meeting timer \(not shared with collaborators\)/i,
    });
    expect(trigger).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/shared timer|synchronized/i);
  });
});

describe("DEC-013 the AR layer is off until the device matrix passes", () => {
  it("is disabled when no deployment opt-in is present", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AR_CANVAS", "");

    expect(isArCanvasEnabled()).toBe(false);
  });

  it('stays disabled for any value other than an explicit "true"', () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AR_CANVAS", "yes");

    expect(isArCanvasEnabled()).toBe(false);
  });

  it("enables only on an explicit opt-in", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AR_CANVAS", "true");

    expect(isArCanvasEnabled()).toBe(true);
  });

  it("labels the surface as experimental with an on-device camera claim", () => {
    expect(AR_EXPERIMENTAL_DISCLOSURE).toMatch(/experimental/i);
    expect(AR_EXPERIMENTAL_DISCLOSURE).toMatch(/never uploaded/i);
  });
});
