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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signOutAndRedirect: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth-client", () => ({
  signOutAndRedirect: mocks.signOutAndRedirect,
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));
vi.mock("@/lib/theme-context", () => ({
  useThemeMode: () => ({ mode: "light", toggleTheme: vi.fn() }),
}));
const { Stub } = vi.hoisted(() => ({ Stub: () => null }));
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
vi.mock("@/app/settings/LinkEnrichmentSettings", () => ({
  LinkEnrichmentSettings: Stub,
}));
vi.mock("@/app/settings/AutoFileSettings", () => ({ AutoFileSettings: Stub }));
vi.mock("@/app/settings/WeeklyRecapSettings", () => ({
  WeeklyRecapSettings: Stub,
}));

import { SettingsContent } from "@/app/settings/SettingsContent";

const fetchMock = vi.fn();

function respond(ok: boolean, body: unknown) {
  return { ok, status: ok ? 200 : 400, json: async () => body };
}

beforeEach(() => {
  mocks.signOutAndRedirect.mockReset().mockResolvedValue(undefined);
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function submitPasswordChange() {
  render(
    <SettingsContent
      user={{ id: "u1", name: "Ada", email: "a@x.io" }}
      section="security"
    />,
  );
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "old-password-123" },
  });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "new-password-456" },
  });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: "new-password-456" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  });
}

describe("settings password change", () => {
  it("signs out to the login page after the server revokes every session", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/v1/users/change-password"
        ? respond(true, { message: "ok" })
        : respond(false, {}),
    );
    await submitPasswordChange();
    await waitFor(() =>
      expect(mocks.signOutAndRedirect).toHaveBeenCalledWith("/auth/login", {
        navigateOnError: true,
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      expect.stringMatching(/sign in/i),
    );
  });

  it("keeps the session and shows the error when the change fails", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/v1/users/change-password"
        ? respond(false, { detail: "Current password is incorrect" })
        : respond(false, {}),
    );
    await submitPasswordChange();
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Current password is incorrect",
      ),
    );
    expect(mocks.signOutAndRedirect).not.toHaveBeenCalled();
  });
});
