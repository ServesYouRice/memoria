// @vitest-environment happy-dom
/**
 * IMP-046 — the version history panel lists automatic and manual versions,
 * previews one read-only, and offers restore only to people who may restore.
 */

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const hooks = vi.hoisted(() => ({
  useCanvasVersionHistory: vi.fn(),
  useCanvasVersion: vi.fn(),
  restore: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/hooks/use-canvas-versions", () => ({
  useCanvasVersionHistory: hooks.useCanvasVersionHistory,
  useCanvasVersion: hooks.useCanvasVersion,
  useRestoreVersion: () => ({ mutateAsync: hooks.restore }),
  useCreateVersion: () => ({ mutateAsync: hooks.create, isPending: false }),
}));

import { VersionHistoryDialog } from "@/features/canvas/components/VersionHistoryDialog";

const versions = [
  {
    id: "v-auto",
    name: "Auto-save 2026-08-25 14:30 UTC",
    kind: "AUTO",
    createdAt: "2026-08-25T14:30:00.000Z",
    createdBy: null,
  },
  {
    id: "v-manual",
    name: "Before the workshop",
    kind: "MANUAL",
    createdAt: "2026-08-24T09:00:00.000Z",
    createdBy: { id: "u1", name: "Ada" },
  },
];

const snapshots: Record<string, unknown> = {
  "v-auto": {
    items: [
      {
        id: "n1",
        type: "NOTE",
        positionX: 0,
        positionY: 0,
        width: 200,
        height: 120,
        zIndex: 0,
        content: { text: "Auto note" },
      },
    ],
  },
  "v-manual": { items: [] },
};

function renderDialog(canRestore: boolean, onClose = vi.fn()) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <VersionHistoryDialog
        open
        onClose={onClose}
        canvasId="canvas-1"
        canRestore={canRestore}
      />
    </QueryClientProvider>,
  );
  return onClose;
}

beforeEach(() => {
  hooks.useCanvasVersionHistory.mockReturnValue({
    data: { pages: [{ versions, pagination: { hasMore: false } }] },
    isLoading: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  });
  hooks.useCanvasVersion.mockImplementation(
    (_canvasId: string, versionId?: string) => ({
      data: versionId
        ? {
            ...versions.find((v) => v.id === versionId),
            snapshot: snapshots[versionId],
          }
        : undefined,
      isLoading: false,
      error: null,
    }),
  );
  hooks.restore.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("VersionHistoryDialog", () => {
  it("lists automatic and manual versions with their author", () => {
    renderDialog(true);
    const list = screen.getByRole("list", { name: "Versions" });
    const items = within(list).getAllByRole("button");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Automatic snapshot")).toBeTruthy();
    expect(within(items[0]).getByText("Auto")).toBeTruthy();
    expect(within(items[1]).getByText("Before the workshop")).toBeTruthy();
    expect(within(items[1]).getByText("Saved")).toBeTruthy();
    expect(within(items[1]).getByText(/by Ada/)).toBeTruthy();
  });

  it("previews the selected version read-only", () => {
    renderDialog(true);
    // Newest is selected first, and shows its note.
    expect(
      screen.getByRole("img", { name: /Read-only preview of .*1 item/ }),
    ).toBeTruthy();
    expect(screen.getAllByText("Auto note").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("Before the workshop"));
    expect(hooks.useCanvasVersion).toHaveBeenLastCalledWith(
      "canvas-1",
      "v-manual",
      true,
    );
    expect(screen.getByText("This version has no items")).toBeTruthy();
  });

  it("asks for the kind filter the user picks", () => {
    renderDialog(true);
    fireEvent.click(screen.getByRole("button", { name: "Saved" }));
    expect(hooks.useCanvasVersionHistory).toHaveBeenLastCalledWith(
      "canvas-1",
      "MANUAL",
      true,
    );
  });

  it("restores the selected version after confirmation", async () => {
    const onClose = renderDialog(true);
    fireEvent.click(screen.getByText("Before the workshop"));
    fireEvent.click(
      screen.getByRole("button", { name: "Restore This Version" }),
    );
    const confirm = await screen.findByRole("button", { name: "Restore" });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(hooks.restore).toHaveBeenCalledWith({
        canvasId: "canvas-1",
        versionId: "v-manual",
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows a restore failure instead of closing", async () => {
    hooks.restore.mockRejectedValue(new Error("Restore refused"));
    const onClose = renderDialog(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Restore This Version" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    expect(await screen.findByText("Restore refused")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers viewers the preview but no restore or save", () => {
    renderDialog(false);
    expect(screen.getByRole("img", { name: /Read-only preview/ })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Restore This Version" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Save Current Version" }),
    ).toBeNull();
    expect(
      screen.getByText("Only owners and editors can restore a version."),
    ).toBeTruthy();
  });
});
