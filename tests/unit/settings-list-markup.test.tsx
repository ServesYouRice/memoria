// @vitest-environment happy-dom
/**
 * IMP-125: list markup the accessibility check accepts. Every child of a
 * `<ul>`/`<ol>` is an `<li>`, and every `<li>` sits in a list.
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
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
const Stub = vi.hoisted(() => () => null);
vi.mock("@/features/agents/components/AgentControlCenter", () => ({
  AgentControlCenter: Stub,
}));
vi.mock("@/features/auth/components/SecuritySettings", () => ({
  SecuritySettings: Stub,
}));
vi.mock("@/app/settings/NotificationPreferences", () => ({
  NotificationPreferences: Stub,
}));
vi.mock("@/app/settings/AiProviderSettings", () => ({
  AiProviderSettings: Stub,
}));

import { SettingsContent } from "@/app/settings/SettingsContent";
import { SETTINGS_SECTIONS } from "@/app/settings/sections";
import { WeeklyRecapSettings } from "@/app/settings/WeeklyRecapSettings";
import { AutoFileSettings } from "@/app/settings/AutoFileSettings";
import { LinkEnrichmentSettings } from "@/app/settings/LinkEnrichmentSettings";

const payloads: Record<string, unknown> = {
  "/api/v1/recaps/settings": { weeklyRecapEmail: true, staleLinkWeeks: 4 },
  "/api/v1/ai/auto-file": { autoFileItems: false, confidenceThreshold: 0.8 },
  "/api/v1/ai/link-enrichment": {
    autoEnrichLinks: true,
    aiConfigured: true,
    webArchiveAvailable: true,
    webArchiveLookup: false,
    taggingRules: "",
  },
};

function expectValidListMarkup(root: HTMLElement) {
  for (const list of Array.from(root.querySelectorAll("ul, ol"))) {
    for (const child of Array.from(list.children)) {
      expect(child.tagName, list.outerHTML.slice(0, 120)).toBe("LI");
    }
  }
  for (const item of Array.from(root.querySelectorAll("li"))) {
    expect(item.parentElement?.tagName, item.outerHTML.slice(0, 120)).toMatch(
      /^(UL|OL)$/,
    );
  }
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url in payloads
        ? { ok: true, json: async () => payloads[url] }
        : { ok: false, json: async () => ({}) },
    ),
  );
  window.location.hash = "";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("settings list markup", () => {
  it("puts every Settings menu link in a list item, on every group", () => {
    for (const section of SETTINGS_SECTIONS) {
      const { container } = render(
        <SettingsContent
          user={{ id: "u1", name: "Ada", email: "a@x.io" }}
          section={section.id}
        />,
      );
      const nav = screen.getAllByRole("navigation", { name: "Settings" })[0];
      expect(nav.querySelectorAll("ul > li > a")).toHaveLength(
        SETTINGS_SECTIONS.length,
      );
      expectValidListMarkup(container);
      cleanup();
    }
  });

  it("keeps the switch rows of the small settings out of list markup", async () => {
    const { container } = render(
      <>
        <WeeklyRecapSettings />
        <AutoFileSettings />
        <LinkEnrichmentSettings />
      </>,
    );
    await screen.findByLabelText("Find web-archive copies of saved links");
    await screen.findByLabelText("Send the weekly recap by email");
    await screen.findByLabelText("File new Inbox items automatically");
    expect(container.querySelectorAll("li")).toHaveLength(0);
    expectValidListMarkup(container);
  });

  it("shows the locked email as read-only, not disabled", () => {
    render(
      <SettingsContent
        user={{ id: "u1", name: "Ada", email: "a@x.io" }}
        section="account"
      />,
    );
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect(email.readOnly).toBe(true);
    expect(email.disabled).toBe(false);
    expect(
      screen.getByText("Your email address cannot be changed."),
    ).toBeTruthy();
  });
});
