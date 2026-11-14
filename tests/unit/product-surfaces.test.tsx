// @vitest-environment happy-dom
/**
 * IMP-032 — optional product-surface semantics (DEC-011 through DEC-013).
 *
 * Each surface must present only what the product implements: embeds are inert
 * link previews, the timer is shared (IMP-105), and the AR layer stays off unless a
 * deployment opts in.
 */

import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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

describe("IMP-105 the meeting timer is shared", () => {
  it("declares shared scope", () => {
    expect(MEETING_TIMER_SCOPE).toBe("shared");
    expect(MEETING_TIMER_DISCLOSURE).toMatch(/everyone on this canvas/i);
  });

  const running = {
    state: {
      status: "running" as const,
      durationMs: 10 * 60_000,
      endsAt: Date.now() + 5 * 60_000,
      updatedAt: Date.now(),
    },
    clockOffsetMs: 0,
  };

  it("shows the running countdown to everyone and says it is shared", () => {
    render(<MeetingTimer timer={running} connected />);
    const trigger = screen.getByRole("button", {
      name: /shared timer: .* left/i,
    });
    expect(trigger.textContent).toMatch(/0[45]:\d\d/);
    fireEvent.click(trigger);
    expect(document.body.textContent).toMatch(/everyone on this canvas/i);
    // A viewer sees no controls, and is told why.
    expect(screen.queryByRole("button", { name: /pause|start/i })).toBeNull();
    expect(document.body.textContent).toMatch(/only people who can edit/i);
  });

  it("lets an editor pause, start and reset", () => {
    const onCommand = vi.fn();
    render(
      <MeetingTimer
        timer={running}
        connected
        canControl
        onCommand={onCommand}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /shared timer/i }));
    fireEvent.click(screen.getByRole("button", { name: /pause/i }));
    expect(onCommand).toHaveBeenCalledWith("pause", 10 * 60_000);
    fireEvent.click(screen.getByRole("button", { name: /reset timer/i }));
    expect(onCommand).toHaveBeenCalledWith("reset", 10 * 60_000);
  });

  it("shows no countdown button while the timer is not running", () => {
    render(
      <MeetingTimer timer={{ state: null, clockOffsetMs: 0 }} connected />,
    );
    expect(screen.queryByRole("button", { name: /shared timer/i })).toBeNull();
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
