// @vitest-environment happy-dom

import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  organize: vi.fn(),
  reject: vi.fn(async () => undefined),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/hooks/use-agent-control", () => {
  const stable = {
    organize: { mutateAsync: hooks.organize },
    reject: { mutateAsync: hooks.reject },
    other: { mutateAsync: vi.fn() },
  };
  return {
    useOrganizeCanvas: () => stable.organize,
    useRejectSuggestion: () => stable.reject,
    useApproveSuggestion: () => stable.other,
    useExecuteSuggestion: () => stable.other,
    useRevertChangeSet: () => stable.other,
  };
});

import { SortIntoPilesDialog } from "@/features/canvas/components/SortIntoPilesDialog";

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("SortIntoPilesDialog stale responses", () => {
  it("ignores a response from before the dialog was closed and reopened", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    hooks.organize
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { rerender } = render(
      <SortIntoPilesDialog canvasId="c1" open onClose={vi.fn()} />,
    );
    rerender(
      <SortIntoPilesDialog canvasId="c1" open={false} onClose={vi.fn()} />,
    );
    rerender(<SortIntoPilesDialog canvasId="c1" open onClose={vi.fn()} />);
    expect(hooks.organize).toHaveBeenCalledTimes(2);

    await act(async () =>
      first.resolve({
        suggestionId: "old",
        piles: [{ title: "Old pile", itemCount: 1 }],
        instruction: "old instruction",
      }),
    );
    expect(screen.queryByText(/Old pile/)).toBeNull();
    expect(screen.getByLabelText("Finding piles")).toBeTruthy();
    expect(hooks.reject).toHaveBeenCalledWith("old");

    await act(async () =>
      second.resolve({
        suggestionId: "new",
        piles: [{ title: "New pile", itemCount: 2 }],
        instruction: "",
      }),
    );
    expect(screen.getByText(/New pile/)).toBeTruthy();
    expect(screen.queryByLabelText("Finding piles")).toBeNull();
  });
});
