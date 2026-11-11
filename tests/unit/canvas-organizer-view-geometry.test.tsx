// @vitest-environment happy-dom
/**
 * TASK-085 — the organizer resolves source items and item-only suggestions
 * against the whole-canvas geometry index, not only the viewport's items.
 */

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const offscreenId = "citemoffscreen00000000001";

vi.mock("@/lib/hooks/use-canvas-views", () => ({
  useCanvasView: () => ({ data: { view: null } }),
  useSaveCanvasView: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-canvas-index", () => ({
  useCanvasGeometry: () => ({
    data: {
      items: [
        {
          id: offscreenId,
          type: "BOOKMARK",
          positionX: 5000,
          positionY: 5000,
          width: 300,
          height: 120,
          zIndex: 0,
          version: 1,
        },
      ],
    },
    isLoading: false,
  }),
}));
vi.mock("@/lib/hooks/use-agent-control", () => ({
  useAgentKnowledge: () => ({
    data: {
      entities: [
        {
          id: "e1",
          entityType: "PERSON",
          title: "Ada Lovelace",
          summary: null,
          status: "ACTIVE",
          sourceConfidence: null,
          itemLinks: [{ itemId: offscreenId }],
          outgoingRelations: [],
          incomingRelations: [],
        },
      ],
    },
    isLoading: false,
  }),
  useAgentTimeline: () => ({
    data: {
      suggestions: [
        {
          id: "s1",
          kind: "INTERNAL_ORGANIZATION",
          status: "OPEN",
          summary: "Tag the off-screen bookmark",
          payload: { kind: "knowledge-entity-create", itemId: offscreenId },
          createdAt: "2026-11-11T00:00:00.000Z",
          expiresAt: "2026-11-12T00:00:00.000Z",
        },
      ],
      changeSets: [],
    },
    isLoading: false,
  }),
}));

import { CanvasOrganizerView } from "@/features/canvas/components/CanvasOrganizerView";

afterEach(cleanup);

describe("CanvasOrganizerView whole-canvas resolution (TASK-085)", () => {
  it("counts an off-viewport source item and keeps its item-only suggestion", () => {
    render(<CanvasOrganizerView canvasId="c1" items={[]} />);

    expect(
      screen.queryByText(
        "This entity no longer has a readable source item on the canvas.",
      ),
    ).toBeNull();
    expect(screen.getByText("bookmark item")).toBeTruthy();
    expect(screen.getByText("Tag the off-screen bookmark")).toBeTruthy();
  });
});
