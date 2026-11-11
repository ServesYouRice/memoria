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
  apiFetch: vi.fn(),
  approve: vi.fn(),
  execute: vi.fn(),
  reject: vi.fn(),
  revert: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: React.forwardRef<HTMLAnchorElement, React.ComponentProps<"a">>(
    function Link({ children, href, ...props }, ref) {
      return (
        <a ref={ref} href={href} {...props}>
          {children}
        </a>
      );
    },
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api/fetch-client", () => ({ apiFetch: mocks.apiFetch }));
vi.mock("@/lib/hooks/use-agent-control", () => ({
  useApproveSuggestion: () => ({ mutateAsync: mocks.approve }),
  useExecuteSuggestion: () => ({ mutateAsync: mocks.execute }),
  useRejectSuggestion: () => ({ mutateAsync: mocks.reject }),
  useRevertChangeSet: () => ({ mutateAsync: mocks.revert }),
}));

import { AskPalette } from "@/features/command-palette/AskPalette";

function respond(body: unknown) {
  mocks.apiFetch.mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

async function ask(question: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Ask Memoria" }), {
    target: { value: question },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
}

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe("Ask palette (IMP-068)", () => {
  it("shows the answer with links to the items used", async () => {
    respond({
      answer: "It is Knife shop.",
      sources: [
        {
          itemId: "i1",
          canvasId: "c1",
          canvasName: "Kitchen",
          type: "BOOKMARK",
          title: "Knife shop",
          url: "https://knives.example",
          href: "/canvas/c1?item=i1",
        },
      ],
      suggestion: null,
      commandRejected: null,
      retrievedCount: 1,
    });
    render(<AskPalette open onClose={vi.fn()} />);

    await ask("what was that knife site?");

    expect(await screen.findByText("It is Knife shop.")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Knife shop/ });
    expect(link.getAttribute("href")).toBe("/canvas/c1?item=i1");
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/v1/ai/ask",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ question: "what was that knife site?" }),
      }),
    );
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("retries only the execution once approval has succeeded", async () => {
    respond({
      answer: "I can make a Japan board.",
      sources: [],
      suggestion: {
        id: "sugg-1",
        summary: 'Create board "Japan" and move 2 items onto it',
        kind: "create_board",
      },
      commandRejected: null,
      retrievedCount: 2,
    });
    mocks.approve.mockResolvedValue({});
    mocks.execute
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({ executed: { changeSetId: "cs-1" } });
    render(<AskPalette open onClose={vi.fn()} />);

    await ask("make a Japan board from everything about Japan");
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Network error")).toBeTruthy();

    fireEvent.click(
      await screen.findByRole("button", { name: /Approve|Retry/ }),
    );

    expect(await screen.findByText("Done.")).toBeTruthy();
    expect(mocks.approve).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("changes nothing until the user approves the suggestion", async () => {
    respond({
      answer: "I can make a Japan board.",
      sources: [],
      suggestion: {
        id: "sugg-1",
        summary: 'Create board "Japan" and move 2 items onto it',
        kind: "create_board",
      },
      commandRejected: null,
      retrievedCount: 2,
    });
    mocks.execute.mockResolvedValue({ executed: { changeSetId: "cs-1" } });
    render(<AskPalette open onClose={vi.fn()} />);

    await ask("make a Japan board from everything about Japan");
    const approve = await screen.findByRole("button", { name: "Approve" });
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();

    fireEvent.click(approve);
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledWith("sugg-1"));
    expect(mocks.approve).toHaveBeenCalledWith("sugg-1");
    expect(await screen.findByText("Done.")).toBeTruthy();
  });

  it("dismissing rejects the suggestion", async () => {
    respond({
      answer: "Archive these?",
      sources: [],
      suggestion: { id: "sugg-2", summary: "Archive 3 items", kind: "archive" },
      commandRejected: null,
      retrievedCount: 3,
    });
    mocks.reject.mockResolvedValue({});
    render(<AskPalette open onClose={vi.fn()} />);

    await ask("archive old recipes");
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(mocks.reject).toHaveBeenCalledWith("sugg-2"));
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
