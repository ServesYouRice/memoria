// @vitest-environment happy-dom

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReminderDialog } from "@/features/canvas/components/ReminderDialog";
import { SomethingOldCard } from "@/features/dashboard/components/SomethingOldCard";
import { RemindersContent } from "@/app/reminders/RemindersContent";
import { morningIn } from "@/lib/hooks/use-reminders";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wrap(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {node}
    </QueryClientProvider>,
  );
}

type Call = [string, RequestInit | undefined];

describe("Remind me (IMP-097)", () => {
  it("sets tomorrow at 9:00 local time", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === "PUT"
        ? Response.json({ reminder: { id: "r", remindAt: "x" } })
        : Response.json({ reminder: null }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();
    wrap(<ReminderDialog itemId="item1" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const put = (fetchMock.mock.calls as unknown as Call[]).find(
      ([, init]) => init?.method === "PUT",
    )!;
    expect(put[0]).toBe("/api/v1/items/item1/reminder");
    expect(JSON.parse(String(put[1]!.body))).toEqual({
      remindAt: morningIn(1).toISOString(),
    });
  });

  it("shows the reminder already set and cancels it", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : Response.json({
            reminder: { id: "r", remindAt: "2030-05-01T09:00:00.000Z" },
          }),
    );
    vi.stubGlobal("fetch", fetchMock);
    wrap(<ReminderDialog itemId="item1" onClose={vi.fn()} />);
    expect(await screen.findByText(/Set for/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel reminder" }));
    await waitFor(() =>
      expect(
        (fetchMock.mock.calls as unknown as Call[]).some(
          ([, init]) => init?.method === "DELETE",
        ),
      ).toBe(true),
    );
  });

  it("shows the server's reason when a time is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "PUT"
          ? Response.json(
              { detail: "Pick a time in the future." },
              { status: 400 },
            )
          : Response.json({ reminder: null }),
      ),
    );
    wrap(<ReminderDialog itemId="item1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Remind me then" }));
    expect(await screen.findByText("Pick a time in the future.")).toBeTruthy();
  });

  it("lists upcoming reminders and cancels one", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : Response.json({
            reminders: [
              {
                id: "r1",
                remindAt: "2030-05-01T09:00:00.000Z",
                itemId: "i1",
                canvasId: "c1",
                canvasName: "Trip",
                title: "Hotel",
                url: "/canvas/c1?item=i1",
              },
            ],
          }),
    );
    vi.stubGlobal("fetch", fetchMock);
    wrap(<RemindersContent />);
    const link = await screen.findByRole("link", { name: "Hotel" });
    expect(link.getAttribute("href")).toBe("/canvas/c1?item=i1");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        (fetchMock.mock.calls as unknown as Call[]).find(
          ([, init]) => init?.method === "DELETE",
        )?.[0],
      ).toBe("/api/v1/items/i1/reminder"),
    );
  });
});

describe("Something old (IMP-097)", () => {
  it("shows one old item and asks for another, skipping the one shown", async () => {
    const old = (id: string, title: string) => ({
      id,
      canvasId: "c1",
      canvasName: "Ideas",
      type: "NOTE",
      title,
      url: `/canvas/c1?item=${id}`,
      savedAt: "2020-01-01T00:00:00.000Z",
      lastOpenedAt: null,
    });
    const fetchMock = vi.fn(async (url: string) =>
      Response.json({
        item: url.includes("exclude=a")
          ? old("b", "Second")
          : old("a", "First"),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    wrap(<SomethingOldCard />);
    expect(await screen.findByText("First")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show another" }));
    expect(await screen.findByText("Second")).toBeTruthy();
    expect(
      (fetchMock.mock.calls as unknown as Call[]).map(([url]) => url),
    ).toContain("/api/v1/something-old?exclude=a");
  });

  it("stays hidden when nothing is old", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ item: null })),
    );
    const { container } = wrap(<SomethingOldCard />);
    await waitFor(() => expect(container.textContent).toBe(""));
  });
});
