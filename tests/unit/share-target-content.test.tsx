// @vitest-environment happy-dom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/fetch-client", () => ({ apiFetch }));
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

import { ShareTargetContent } from "@/app/share-target/ShareTargetContent";

const link = { url: "https://example.com/article?x=1", title: "An article" };
const shareId = "share-id-000000000001";

function renderShare() {
  return render(
    <ShareTargetContent link={link} shareId={shareId} sharedText={null} />,
  );
}

class StubIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  apiFetch.mockReset();
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
});
afterEach(() => {
  cleanup();
});

describe("ShareTargetContent", () => {
  it("saves nothing until the user chooses Save to Inbox", async () => {
    let respond!: (response: Response) => void;
    apiFetch.mockReturnValue(
      new Promise<Response>((resolve) => (respond = resolve)),
    );
    renderShare();
    await act(async () => {});

    // A page that merely navigated the user here has saved nothing.
    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getByText("example.com")).toBeTruthy();
    expect(screen.getByText(link.title)).toBeTruthy();
    expect(screen.getByText(link.url)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Cancel" }).getAttribute("href"),
    ).toBe("/dashboard");

    const button = screen.getByRole("button", { name: "Save to Inbox" });
    fireEvent.click(button);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/share-target/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shareId, url: link.url, title: link.title }),
    });

    // A second click while the save is pending sends nothing more.
    fireEvent.click(button);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      respond(
        Response.json({ batchId: "b1", canvasId: "c1", replayed: false }),
      );
    });
    expect(screen.getByRole("heading", { name: "Saved" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open Inbox" }).getAttribute("href"),
    ).toBe("/canvas/c1");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("shows the server's reason when the save fails", async () => {
    apiFetch.mockResolvedValue(
      Response.json({ detail: "Inbox is full." }, { status: 422 }),
    );
    renderShare();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save to Inbox" }));
    });
    expect(screen.getByRole("heading", { name: "Not saved" })).toBeTruthy();
    expect(screen.getByText("Inbox is full.")).toBeTruthy();
  });
});
