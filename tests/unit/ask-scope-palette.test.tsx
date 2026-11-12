// @vitest-environment happy-dom
/**
 * IMP-101 — the Ask box shows where it looks, offers "This canvas" first
 * inside a canvas, sends the chosen scope and says which scope answered.
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

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("@/lib/api/fetch-client", () => ({ apiFetch: mocks.apiFetch }));
vi.mock("@/lib/hooks/use-agent-control", () => ({
  useApproveSuggestion: () => ({ mutateAsync: vi.fn() }),
  useExecuteSuggestion: () => ({ mutateAsync: vi.fn() }),
  useRejectSuggestion: () => ({ mutateAsync: vi.fn() }),
  useRevertChangeSet: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AskPalette } from "@/features/command-palette/AskPalette";

const choices = {
  canvases: [
    { id: "canvas-k", name: "Kitchen" },
    { id: "canvas-j", name: "Japan" },
  ],
  tags: ["recipes"],
};

function posts() {
  return mocks.apiFetch.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([, init]) => JSON.parse(init.body as string));
}

async function ask(text: string) {
  const input = screen.getByRole("textbox", { name: "Ask Memoria" });
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    fireEvent.submit(input.closest("form")!);
  });
}

function scopeBox() {
  return screen.getByRole("combobox", { name: /^Looking in/ });
}

describe("Ask scope (IMP-101)", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.apiFetch.mockImplementation(
      async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST")
          return { ok: true, json: async () => choices };
        const { scope } = JSON.parse(init.body as string);
        const label =
          scope.kind === "tag"
            ? `Tag “${scope.tag}”`
            : scope.kind === "canvas"
              ? "Canvas “Kitchen”"
              : "All canvases";
        return {
          ok: true,
          json: async () => ({
            answer: "Here.",
            sources: [],
            suggestion: null,
            commandRejected: null,
            retrievedCount: 0,
            scope: { kind: scope.kind, label },
          }),
        };
      },
    );
  });
  afterEach(cleanup);

  it("looks in all canvases by default and says so", async () => {
    await act(async () => {
      render(<AskPalette open onClose={() => undefined} />);
    });
    expect(scopeBox().textContent).toContain("All canvases");
    await ask("knife site");
    expect(posts()[0].scope).toEqual({ kind: "all" });
    expect(await screen.findByText("Looked in: All canvases")).toBeTruthy();
  });

  it("offers This canvas first inside a canvas, and can switch to a tag", async () => {
    await act(async () => {
      render(<AskPalette open onClose={() => undefined} canvasId="canvas-k" />);
    });
    expect(scopeBox().textContent).toContain("This canvas");

    fireEvent.mouseDown(scopeBox());
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options[0]!.textContent).toBe("This canvas");
    expect(options[1]!.textContent).toBe("All canvases");
    // The current canvas is not listed twice.
    expect(options.map((o) => o.textContent)).not.toContain("Kitchen");
    expect(options.map((o) => o.textContent)).toContain("Japan");
    await act(async () => {
      fireEvent.click(options[0]!);
    });

    await ask("soup");
    expect(posts()[0].scope).toEqual({ kind: "canvas", canvasId: "canvas-k" });
    expect(await screen.findByText("Looked in: Canvas “Kitchen”")).toBeTruthy();

    fireEvent.mouseDown(scopeBox());
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Tag “recipes”" }));
    });
    await ask("soup");
    expect(posts()[1].scope).toEqual({ kind: "tag", tag: "recipes" });
    expect(await screen.findByText("Looked in: Tag “recipes”")).toBeTruthy();
  });

  it("does not offer a canvas the person does not own", async () => {
    await act(async () => {
      render(
        <AskPalette open onClose={() => undefined} canvasId="shared-canvas" />,
      );
    });
    expect(scopeBox().textContent).toContain("All canvases");
    fireEvent.mouseDown(scopeBox());
    expect(screen.queryByRole("option", { name: "This canvas" })).toBeNull();
  });
});
