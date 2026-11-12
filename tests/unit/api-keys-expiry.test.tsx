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
import { ApiError } from "@/lib/api/fetch-client";

const toastError = vi.hoisted(() => vi.fn());
const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn() },
}));
vi.mock("@/lib/hooks/use-api-keys", () => ({
  useApiKeys: () => ({ data: { keys: [] }, isLoading: false, error: null }),
  useCreateApiKey: () => ({ mutateAsync, isPending: false }),
  useRevokeApiKey: () => ({ mutate: vi.fn(), isPending: false }),
}));

import {
  ApiKeysContent,
  localDateInputValue,
  localEndOfDayIso,
} from "@/app/api-keys/ApiKeysContent";

const originalTz = process.env.TZ;

beforeEach(() => {
  toastError.mockReset();
  mutateAsync.mockReset();
});
afterEach(() => {
  cleanup();
  process.env.TZ = originalTz;
});

function openDialogAndFill(date: string) {
  fireEvent.click(
    screen.getAllByRole("button", { name: /^create api key$/i })[0]!,
  );
  fireEvent.change(screen.getByLabelText("Key name"), {
    target: { value: "Extension" },
  });
  const dateInput = screen.getByLabelText(
    "Expires on (optional)",
  ) as HTMLInputElement;
  fireEvent.change(dateInput, { target: { value: date } });
  return dateInput;
}

describe("API key expiry date", () => {
  it.each([
    ["America/Los_Angeles", "2026-11-13T07:59:59.999Z"],
    ["Asia/Tokyo", "2026-11-12T14:59:59.999Z"],
  ])("ends the chosen day in local time (%s)", (tz, expected) => {
    process.env.TZ = tz;
    expect(localEndOfDayIso("2026-11-12")).toBe(expected);
  });

  it("formats today's local date for the input min", () => {
    process.env.TZ = "America/Los_Angeles";
    // 2026-11-12T03:00Z is still Nov 11 in Los Angeles.
    expect(localDateInputValue(new Date("2026-11-12T03:00:00Z"))).toBe(
      "2026-11-11",
    );
  });

  it("sends the end of the chosen local day and limits the input to today onward", async () => {
    process.env.TZ = "America/Los_Angeles";
    mutateAsync.mockResolvedValue({ plaintextKey: "mk_test" });
    render(<ApiKeysContent serverAddress="https://memoria.example" />);
    const dateInput = openDialogAndFill("2026-11-12");
    expect(dateInput.min).toBe(localDateInputValue(new Date()));

    const createButtons = screen.getAllByRole("button", { name: /^create$/i });
    await act(async () => {
      fireEvent.click(createButtons[createButtons.length - 1]!);
    });

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0]![0]).toEqual({
      name: "Extension",
      expiresAt: "2026-11-13T07:59:59.999Z",
    });
  });

  it("shows the server's rejection message", async () => {
    mutateAsync.mockRejectedValue(
      new ApiError(400, "expiresAt must be in the future"),
    );
    render(<ApiKeysContent serverAddress="https://memoria.example" />);
    openDialogAndFill("2026-11-12");
    const createButtons = screen.getAllByRole("button", { name: /^create$/i });
    await act(async () => {
      fireEvent.click(createButtons[createButtons.length - 1]!);
    });

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "expiresAt must be in the future",
      ),
    );
  });

  it("keeps the dialog open with a sign-in-again notice when the session is not recent", async () => {
    mutateAsync.mockRejectedValue(
      new ApiError(403, "Sign in again to create an API key.", {
        code: "recent_sign_in_required",
      }),
    );
    render(<ApiKeysContent serverAddress="https://memoria.example" />);
    openDialogAndFill("2026-11-12");
    const createButtons = screen.getAllByRole("button", { name: /^create$/i });
    await act(async () => {
      fireEvent.click(createButtons[createButtons.length - 1]!);
    });

    expect(
      await screen.findByText("Sign in again to create an API key."),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Sign in again" }).getAttribute("href"),
    ).toBe("/auth/login?callbackUrl=%2Fapi-keys");
    expect(screen.getByLabelText("Key name")).toBeTruthy();
    expect(toastError).not.toHaveBeenCalled();
  });
});
