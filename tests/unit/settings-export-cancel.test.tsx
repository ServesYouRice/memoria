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
  toastInfo: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth-client", () => ({
  signOutAndRedirect: mocks.signOutAndRedirect,
}));
vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
    info: mocks.toastInfo,
  },
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
  mocks.toastInfo.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function routeFetch(deleteResult: () => Promise<unknown>) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/v1/users/account/exports" && init?.method === "POST") {
      return respond(true, { id: "exp-1" });
    }
    if (url === "/api/v1/users/account/exports/exp-1") {
      if (init?.method === "DELETE") return deleteResult();
      if (init?.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      return respond(true, { status: "RUNNING" });
    }
    return respond(false, {});
  });
}

async function startExport() {
  render(
    <SettingsContent
      user={{ id: "u1", name: "Ada", email: "a@x.io" }}
      section="data"
    />,
  );
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Download account data" }),
    );
  });
  return screen.findByRole("button", { name: "Cancel export" });
}

describe("account export cancellation", () => {
  it.each([
    ["a 500 response", async () => respond(false, { detail: "boom" })],
    [
      "a network failure",
      async () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("keeps the export and reports an error on %s", async (_label, result) => {
    routeFetch(result);
    const cancel = await startExport();
    await act(async () => {
      fireEvent.click(cancel);
    });
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.toastInfo).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel export" })).toBeTruthy();
  });

  it("reports cancellation once after the server confirms it", async () => {
    routeFetch(async () => respond(true, { status: "CANCELLED" }));
    const cancel = await startExport();
    await act(async () => {
      fireEvent.click(cancel);
    });
    await waitFor(() =>
      expect(mocks.toastInfo).toHaveBeenCalledWith("Account export cancelled"),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Cancel export" }),
      ).toBeNull(),
    );
    expect(mocks.toastInfo).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
