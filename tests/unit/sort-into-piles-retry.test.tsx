// @vitest-environment happy-dom

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  organize: vi.fn(),
  approve: vi.fn(),
  execute: vi.fn(),
  reject: vi.fn(),
  revert: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: vi.fn() },
}));
vi.mock("@/lib/hooks/use-agent-control", () => ({
  useOrganizeCanvas: () => ({ mutateAsync: mocks.organize }),
  useApproveSuggestion: () => ({ mutateAsync: mocks.approve }),
  useExecuteSuggestion: () => ({ mutateAsync: mocks.execute }),
  useRejectSuggestion: () => ({ mutateAsync: mocks.reject }),
  useRevertChangeSet: () => ({ mutateAsync: mocks.revert }),
}));

import { SortIntoPilesDialog } from "@/features/canvas/components/SortIntoPilesDialog";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.organize.mockResolvedValue({
    suggestionId: "sug-1",
    piles: [{ title: "Travel", itemCount: 2 }],
    method: "words",
    instruction: null,
  });
  mocks.approve.mockResolvedValue({});
});

describe("SortIntoPilesDialog apply retry", () => {
  it("retries only execute after approve succeeded and execute failed", async () => {
    mocks.execute
      .mockRejectedValueOnce(new Error("Network down"))
      .mockResolvedValueOnce({
        executed: { changeSetId: "cs-1", movedItemCount: 2 },
      });
    const onClose = vi.fn();
    render(<SortIntoPilesDialog canvasId="c1" open onClose={onClose} />);

    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));
    await screen.findByText("Network down");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.approve).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.execute).toHaveBeenLastCalledWith("sug-1");
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Sorted 2 items into 1 piles",
      expect.anything(),
    );
  });
});
