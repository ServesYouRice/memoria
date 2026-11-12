// @vitest-environment happy-dom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { probeLiveConnection, SetupCheck } from "@/app/setup/SetupCheck";

class FakeSocket {
  static next: "open" | "error" | "silent" = "open";
  static urls: string[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    FakeSocket.urls.push(url);
    const outcome = FakeSocket.next;
    setTimeout(() => {
      if (outcome === "open") this.onopen?.();
      if (outcome === "error") this.onerror?.();
    }, 0);
  }
  close() {
    this.closed = true;
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  FakeSocket.urls = [];
});

describe("live connection probe (IMP-100)", () => {
  it("opens the sync socket on the page's own address", async () => {
    FakeSocket.next = "open";
    const ok = await probeLiveConnection(
      "https://notes.example.com",
      (url) => new FakeSocket(url) as never,
    );
    expect(ok).toBe(true);
    expect(FakeSocket.urls).toEqual([
      "wss://notes.example.com/api/collaboration/sync",
    ]);
  });

  it("fails when the proxy drops it or nothing answers", async () => {
    FakeSocket.next = "error";
    expect(
      await probeLiveConnection("http://x", (u) => new FakeSocket(u) as never),
    ).toBe(false);
    FakeSocket.next = "silent";
    expect(
      await probeLiveConnection(
        "http://x",
        (u) => new FakeSocket(u) as never,
        20,
      ),
    ).toBe(false);
  });
});

describe("first-run set-up check (IMP-100)", () => {
  it("lists each part and the fix for what is broken", async () => {
    FakeSocket.next = "error";
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ok: false,
          checks: [
            { name: "database", label: "Database", ok: true },
            {
              name: "sync-server",
              label: "Sync server",
              ok: false,
              fix: "Start the sync server.",
            },
          ],
        }),
      ),
    );
    render(<SetupCheck />);
    await waitFor(() =>
      expect(screen.getByText("Database: working")).toBeTruthy(),
    );
    expect(screen.getByText("Sync server: not working")).toBeTruthy();
    expect(screen.getByText("Start the sync server.")).toBeTruthy();
    expect(
      screen.getByText("Live connection through your proxy: not working"),
    ).toBeTruthy();
    expect(screen.getByText(/passes WebSocket connections/)).toBeTruthy();
    expect(screen.queryByText(/Every part is working/)).toBeNull();
  });
});
