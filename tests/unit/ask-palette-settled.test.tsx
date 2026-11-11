// @vitest-environment happy-dom
/**
 * TASK-117 — an older suggestion's approval never marks a newer suggestion
 * as done, and a new question waits while a suggestion is being applied.
 */

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  approve: vi.fn(),
  execute: vi.fn(),
  reject: vi.fn(),
  revert: vi.fn(),
}));

vi.mock("@/lib/api/fetch-client", () => ({ apiFetch: mocks.apiFetch }));
vi.mock("@/lib/hooks/use-agent-control", () => ({
  useApproveSuggestion: () => ({ mutateAsync: mocks.approve }),
  useExecuteSuggestion: () => ({ mutateAsync: mocks.execute }),
  useRejectSuggestion: () => ({ mutateAsync: mocks.reject }),
  useRevertChangeSet: () => ({ mutateAsync: mocks.revert }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AskPalette } from "@/features/command-palette/AskPalette";

function askResponse(id: string, summary: string) {
  return {
    ok: true,
    json: async () => ({
      answer: `Answer for ${summary}`,
      sources: [],
      suggestion: { id, summary, kind: "ask-command" },
      commandRejected: null,
      retrievedCount: 0,
    }),
  };
}

async function ask(text: string) {
  const input = screen.getByRole("textbox", { name: "Ask Memoria" });
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    fireEvent.submit(input.closest("form")!);
  });
}

describe("AskPalette suggestion settling (TASK-117)", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.apiFetch
      .mockResolvedValueOnce(askResponse("sugg-a", "Move A"))
      .mockResolvedValueOnce(askResponse("sugg-b", "Move B"));
    mocks.approve.mockResolvedValue({});
  });
  afterEach(cleanup);

  it("blocks a new question while applying, and never settles a newer suggestion", async () => {
    let finishExecute: (value: unknown) => void = () => undefined;
    mocks.execute.mockImplementation(
      () => new Promise((resolve) => (finishExecute = resolve)),
    );
    render(<AskPalette open onClose={() => undefined} />);

    await ask("move a");
    expect(await screen.findByText("Move A")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    });
    expect(screen.getByRole("button", { name: "Applying…" })).toBeTruthy();

    // A new question while A is still applying.
    await ask("move b");
    expect(
      (screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await act(async () => {
      finishExecute({ executed: { changeSetId: "cs-a" } });
    });

    // If B had been shown, A finishing must not mark it done.
    if (screen.queryByText("Move B")) {
      expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
    }
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Done.")).toBeTruthy();

    // Once A is applied, B can be asked and keeps its controls.
    await ask("move b");
    expect(await screen.findByText("Move B")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });
});
