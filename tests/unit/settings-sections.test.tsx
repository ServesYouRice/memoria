// @vitest-environment happy-dom
/**
 * IMP-086: Settings shows one group at a time, each at its own address, with
 * a side menu, a short intro, and reasons beside greyed-out buttons.
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.hoisted(() => vi.fn());
const Stub = vi.hoisted(() => () => null);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
}));
vi.mock("@/lib/auth-client", () => ({ signOutAndRedirect: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/theme-context", () => ({
  useThemeMode: () => ({ mode: "light", toggleTheme: vi.fn() }),
}));
vi.mock("@/features/agents/components/AgentControlCenter", () => ({
  AgentControlCenter: () => <div>Agent control center</div>,
}));
vi.mock("@/features/auth/components/SecuritySettings", () => ({
  SecuritySettings: Stub,
}));
vi.mock("@/app/settings/NotificationPreferences", () => ({
  NotificationPreferences: () => <div>Notification choices</div>,
}));
vi.mock("@/app/settings/AiProviderSettings", () => ({
  AiProviderSettings: () => <div>AI provider choices</div>,
}));
vi.mock("@/app/settings/LinkEnrichmentSettings", () => ({
  LinkEnrichmentSettings: Stub,
}));
vi.mock("@/app/settings/AutoFileSettings", () => ({ AutoFileSettings: Stub }));
vi.mock("@/app/settings/WeeklyRecapSettings", () => ({
  WeeklyRecapSettings: () => <div>Weekly recap</div>,
}));

import { SettingsContent } from "@/app/settings/SettingsContent";
import {
  SETTINGS_SECTIONS,
  settingsSectionFromSegments,
} from "@/app/settings/sections";

const user = { id: "u1", name: "Ada", email: "a@x.io" };

beforeEach(() => {
  replace.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, json: async () => ({}) })),
  );
  window.location.hash = "";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("settings groups", () => {
  it("has seven groups, each with its own address", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.label)).toEqual([
      "Account",
      "Sign-in and security",
      "Appearance",
      "Notifications",
      "AI assistant",
      "Import",
      "Your data",
    ]);
    expect(settingsSectionFromSegments(undefined)?.id).toBe("account");
    expect(settingsSectionFromSegments(["ai"])?.id).toBe("ai");
    expect(settingsSectionFromSegments(["nope"])).toBeNull();
    expect(settingsSectionFromSegments(["ai", "x"])).toBeNull();
  });

  it("links every group from the menu and marks the open one", () => {
    render(<SettingsContent user={user} section="notifications" />);
    const nav = screen.getAllByRole("navigation", { name: "Settings" })[0];
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      SETTINGS_SECTIONS.map((section) => section.path),
    );
    expect(
      links.find((link) => link.getAttribute("aria-current") === "page")
        ?.textContent,
    ).toBe("Notifications");
  });

  it("shows only the open group, with its one-line intro", () => {
    render(<SettingsContent user={user} section="notifications" />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Notifications" }),
    ).toBeTruthy();
    expect(screen.getByText(/weekly recap\./)).toBeTruthy();
    expect(screen.getByText("Weekly recap")).toBeTruthy();
    expect(screen.queryByLabelText("Full name")).toBeNull();
    expect(screen.queryByText("AI provider choices")).toBeNull();
  });

  it("keeps sign out out of settings", () => {
    for (const section of SETTINGS_SECTIONS) {
      render(<SettingsContent user={user} section={section.id} />);
      expect(screen.queryByRole("button", { name: /sign out$/i })).toBeNull();
      cleanup();
    }
  });

  it("says why Save is greyed out until the name changes", () => {
    render(<SettingsContent user={user} section="account" />);
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save.hasAttribute("disabled")).toBe(true);
    expect(save.getAttribute("aria-describedby")).toBe("profile-save-reason");
    expect(screen.getByText("Change your name to save it.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Ada L" },
    });
    expect(screen.queryByText("Change your name to save it.")).toBeNull();
  });

  it("says why Change password is greyed out", () => {
    render(<SettingsContent user={user} section="security" />);
    expect(screen.getByText("Fill in all three fields first.")).toBeTruthy();
  });

  it("sends old one-page anchors to their new group", () => {
    window.location.hash = "#agent-console";
    render(<SettingsContent user={user} section="account" />);
    expect(replace).toHaveBeenCalledWith("/settings/ai#agent-console");
  });
});
