// @vitest-environment happy-dom
/**
 * TASK-084 — remounting the organizer with a cached saved view must not save
 * the default filters over it; a user change still saves once.
 */

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  viewData: undefined as unknown,
  save: vi.fn(),
}));

vi.mock("@/lib/hooks/use-canvas-views", () => ({
  useCanvasView: () => ({ data: hooks.viewData }),
  useSaveCanvasView: () => ({ mutate: hooks.save }),
}));
vi.mock("@/lib/hooks/use-canvas-index", () => ({
  useCanvasGeometry: () => ({ data: { items: [] }, isLoading: false }),
}));
vi.mock("@/lib/hooks/use-agent-control", () => ({
  useAgentKnowledge: () => ({
    data: {
      entities: [
        {
          id: "e1",
          entityType: "PERSON",
          status: "ACTIVE",
          summary: null,
          sourceConfidence: null,
          title: "Ada",
          itemLinks: [],
          outgoingRelations: [],
          incomingRelations: [],
        },
      ],
    },
    isLoading: false,
  }),
  useAgentTimeline: () => ({
    data: { suggestions: [], changeSets: [] },
    isLoading: false,
  }),
}));

import { CanvasOrganizerView } from "@/features/canvas/components/CanvasOrganizerView";

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("CanvasOrganizerView saved-view hydration (TASK-084)", () => {
  beforeEach(() => {
    hooks.save.mockReset();
  });
  afterEach(cleanup);

  it("does not save on mount with cached non-default filters", async () => {
    hooks.viewData = {
      view: {
        filters: { entityTypeFilter: "PERSON", suggestionStatusFilter: "ALL" },
      },
    };
    render(<CanvasOrganizerView canvasId="c1" items={[]} />);
    await flush();
    expect(hooks.save).not.toHaveBeenCalled();
  });

  it("does not save on mount without a saved view, and saves a user change once", async () => {
    hooks.viewData = { view: null };
    render(<CanvasOrganizerView canvasId="c1" items={[]} />);
    await flush();
    expect(hooks.save).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole("combobox", { name: /entity type/i }));
    fireEvent.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "PERSON",
      }),
    );
    await flush();
    expect(hooks.save).toHaveBeenCalledTimes(1);
    expect(hooks.save).toHaveBeenCalledWith({
      name: "Organizer",
      filters: { entityTypeFilter: "PERSON", suggestionStatusFilter: "OPEN" },
      layout: { mode: "read-only" },
    });
  });
});
