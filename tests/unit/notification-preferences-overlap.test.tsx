// @vitest-environment happy-dom

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api/fetch-client", () => ({ apiFetch: fetchMock.apiFetch }));

import { NotificationPreferences } from "@/app/settings/NotificationPreferences";

type Pref = { type: string; inAppEnabled: boolean; emailEnabled: boolean };

const initial: Pref[] = [
  { type: "CANVAS_SHARED", inAppEnabled: true, emailEnabled: true },
  { type: "SHARE_INVITATION_ACCEPTED", inAppEnabled: true, emailEnabled: true },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let puts: Array<{ body: Pref; resolve: (r: Response) => void }> = [];

function renderPrefs() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <NotificationPreferences />
    </QueryClientProvider>,
  );
  return client;
}

function toggle(name: string) {
  fireEvent.click(screen.getByRole("switch", { name }));
}

afterEach(cleanup);

beforeEach(() => {
  puts = [];
  fetchMock.apiFetch.mockReset();
  fetchMock.apiFetch.mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      return new Promise<Response>((resolve) => {
        puts.push({ body: JSON.parse(String(init.body)), resolve });
      });
    }
    return Promise.resolve(json({ preferences: initial }));
  });
});

describe("notification preference saves", () => {
  it("never resends a stale flag while an earlier save of the same type is pending", async () => {
    renderPrefs();
    await screen.findByRole("switch", {
      name: "Canvas invitations in-app notifications",
    });

    toggle("Canvas invitations in-app notifications");
    await waitFor(() => expect(puts).toHaveLength(1));
    toggle("Accepted invitations email notifications");
    await waitFor(() => expect(puts).toHaveLength(2));

    const aEmail = screen.getByRole("switch", {
      name: "Canvas invitations email notifications",
    });
    const disabled = aEmail.hasAttribute("disabled");
    toggle("Canvas invitations email notifications");
    await act(async () => {});

    const laterA = puts.slice(2).filter((p) => p.body.type === "CANVAS_SHARED");
    if (!disabled) {
      for (const put of laterA) expect(put.body.inAppEnabled).toBe(false);
    } else {
      expect(laterA).toHaveLength(0);
    }
    expect(disabled || laterA.length > 0).toBe(true);
  });

  it("rolls the optimistic row back when a save fails", async () => {
    renderPrefs();
    const inApp = await screen.findByRole("switch", {
      name: "Canvas invitations in-app notifications",
    });
    toggle("Canvas invitations in-app notifications");
    await waitFor(() => expect(puts).toHaveLength(1));
    expect((inApp as HTMLInputElement).checked).toBe(false);
    await act(async () => {
      puts[0]!.resolve(json({ error: "nope" }, 500));
    });
    await waitFor(() =>
      expect(
        (
          screen.getByRole("switch", {
            name: "Canvas invitations in-app notifications",
          }) as HTMLInputElement
        ).checked,
      ).toBe(true),
    );
  });
});
