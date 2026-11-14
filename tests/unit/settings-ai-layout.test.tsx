// @vitest-environment happy-dom
/**
 * IMP-131: Settings -> AI assistant shows three short cards; agents, more
 * providers, history and the exact allowance numbers sit in one "Advanced"
 * block that is closed unless the address asks for `#agent-console`.
 */
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth-client", () => ({ signOutAndRedirect: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/theme-context", () => ({
  useThemeMode: () => ({ mode: "light", toggleTheme: vi.fn() }),
}));
vi.mock("@/features/agents/components/AgentControlCenter", () => ({
  AgentControlCenter: () => <div>AI helpers and history</div>,
}));
vi.mock("@/app/settings/AiProviderSettings", () => ({
  AiProviderSettings: () => <div>Connect a key</div>,
}));
vi.mock("@/app/settings/LinkEnrichmentSettings", () => ({
  LinkEnrichmentSettings: () => <div>Link summaries switch</div>,
}));
vi.mock("@/app/settings/AutoFileSettings", () => ({
  AutoFileSettings: () => <div>Auto-file switch</div>,
}));

import { SettingsContent } from "@/app/settings/SettingsContent";

const user = { id: "u1", name: "Ada", email: "a@x.io" };

function usage(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    tokensUsed: 2_500,
    tokenLimit: 10_000,
    costMicroUsdUsed: 12_300,
    costMicroUsdLimit: 100_000,
    activeRequests: 1,
    concurrencyLimit: 2,
    requests: 3,
    rejections: 4,
    ...overrides,
  };
}

function serveUsage(ai: ReturnType<typeof usage>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ usage: { ai } }),
    })),
  );
}

function advancedToggle() {
  return screen.getByRole("button", {
    name: "Advanced: agents, more providers, history",
  });
}

beforeEach(() => {
  window.location.hash = "";
  serveUsage(usage());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("AI assistant settings layout", () => {
  it("shows connect, the two switches and Used today, with Advanced closed", async () => {
    render(<SettingsContent user={user} section="ai" />);

    expect(
      screen.getByRole("heading", { name: "Connect your AI" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "What AI may do" }),
    ).toBeTruthy();
    expect(screen.getByText("Link summaries switch")).toBeTruthy();
    expect(screen.getByText("Auto-file switch")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Used today" })).toBeTruthy();

    expect(advancedToggle().getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("agent-console")).toBeTruthy();
    expect(document.querySelectorAll("#agent-console")).toHaveLength(1);
  });

  it("opens Advanced when the address ends in #agent-console", () => {
    window.location.hash = "#agent-console";
    render(<SettingsContent user={user} section="ai" />);

    expect(advancedToggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("says what was used today as a percent, never in worst-case tokens", async () => {
    render(<SettingsContent user={user} section="ai" />);

    expect(
      await screen.findByText("25% of today's AI allowance used (3 requests)."),
    ).toBeTruthy();
    expect(
      screen.getByRole("progressbar", {
        name: "Share of today's AI allowance used",
      }),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/worst-case/i);
    expect(document.body.textContent).not.toMatch(/Cost allowance:/);

    // Every number shown before is still there, inside Advanced.
    expect(
      screen.getByText("Tokens set aside today: 2,500 of 10,000"),
    ).toBeTruthy();
    expect(
      screen.getByText("Cost so far today: $0.0123 of $0.1000"),
    ).toBeTruthy();
    expect(screen.getByText("Requests running now: 1 of 2")).toBeTruthy();
    expect(screen.getByText("Requests refused today: 4")).toBeTruthy();
  });

  it("says one request, or that nothing was used", async () => {
    serveUsage(usage({ tokensUsed: 120, requests: 1 }));
    render(<SettingsContent user={user} section="ai" />);
    expect(
      await screen.findByText("1% of today's AI allowance used (1 request)."),
    ).toBeTruthy();
    cleanup();

    serveUsage(usage({ tokensUsed: 0, requests: 0 }));
    render(<SettingsContent user={user} section="ai" />);
    await waitFor(() =>
      expect(screen.getByText("Nothing used today.")).toBeTruthy(),
    );
  });
});
