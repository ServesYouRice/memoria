// @vitest-environment happy-dom
/**
 * TASK-022 / TASK-130 — the organizer asks the server for its own canvas's
 * timeline (and the chosen suggestion status), and says when a list is
 * incomplete.
 */

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  timeline: vi.fn(),
  savedFilters: null as Record<string, unknown> | null,
  hasMore: false,
}));

vi.mock("@/lib/hooks/use-canvas-views", () => ({
  useCanvasView: () => ({
    data: { view: state.savedFilters ? { filters: state.savedFilters } : null },
  }),
  useSaveCanvasView: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-canvas-index", () => ({
  useCanvasGeometry: () => ({ data: { items: [] }, isLoading: false }),
}));
vi.mock("@/lib/hooks/use-agent-control", () => ({
  useAgentKnowledge: () => ({ data: { entities: [] }, isLoading: false }),
  useAgentTimeline: (...args: unknown[]) => {
    state.timeline(...args);
    return {
      data: {
        suggestions: [
          {
            id: "s1",
            kind: "INTERNAL_ORGANIZATION",
            status: "OPEN",
            summary: "Older open suggestion for this canvas",
            payload: { canvasId: "c1" },
            createdAt: "2026-01-01T00:00:00.000Z",
            expiresAt: "2026-11-12T00:00:00.000Z",
          },
        ],
        changeSets: [],
        suggestionsHasMore: state.hasMore,
        changeSetsHasMore: state.hasMore,
      },
      isLoading: false,
    };
  },
}));

import { CanvasOrganizerView } from "@/features/canvas/components/CanvasOrganizerView";

beforeEach(() => {
  state.timeline.mockReset();
  state.savedFilters = null;
  state.hasMore = false;
});
afterEach(cleanup);

function lastOptions() {
  return state.timeline.mock.calls.at(-1)?.[1] as
    { canvasId?: string; suggestionStatuses?: string[] } | undefined;
}

describe("CanvasOrganizerView timeline request", () => {
  it("requests the timeline for its own canvas (TASK-022)", () => {
    render(<CanvasOrganizerView canvasId="c1" items={[]} />);
    expect(lastOptions()?.canvasId).toBe("c1");
    expect(
      screen.getByText("Older open suggestion for this canvas"),
    ).toBeTruthy();
    expect(screen.queryByText(/Only the newest suggestions/)).toBeNull();
  });

  it("says when the server has more than it returned (TASK-022)", () => {
    state.hasMore = true;
    render(<CanvasOrganizerView canvasId="c1" items={[]} />);
    expect(screen.getByText(/Only the newest suggestions/)).toBeTruthy();
    expect(screen.getByText(/Only the newest change sets/)).toBeTruthy();
  });
});
