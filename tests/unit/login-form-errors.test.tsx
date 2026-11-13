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

const signInEmail = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { email: signInEmail, passkey: vi.fn() } },
}));

import { describeWait, LoginForm } from "@/features/auth/components/LoginForm";

class StubIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  signInEmail.mockReset();
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function submit() {
  render(<LoginForm />);
  fireEvent.change(screen.getByRole("textbox", { name: /email/i }), {
    target: { value: "ada@example.com" },
  });
  fireEvent.change(document.querySelector("input[type=password]")!, {
    target: { value: "secret-password" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  });
}

describe("LoginForm sign-in errors", () => {
  it.each([
    [{ code: "LOGIN_SAFETY_UNAVAILABLE", status: 503 }],
    [{ status: 503 }],
  ])("reports temporary unavailability for %o", async (error) => {
    signInEmail.mockResolvedValue({ data: null, error });
    await submit();
    expect(
      await screen.findByText(/sign-in is temporarily unavailable/i),
    ).toBeTruthy();
    expect(screen.queryByText("Invalid email or password")).toBeNull();
  });

  it.each([
    [
      { status: 429 },
      "Too many sign-in attempts. Please try again in up to 15 minutes.",
    ],
    [
      { status: 401, code: "INVALID_EMAIL_OR_PASSWORD" },
      "Invalid email or password",
    ],
  ])("shows the matching message for %o", async (error, message) => {
    signInEmail.mockResolvedValue({ data: null, error });
    await submit();
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("says how long to wait using the server's Retry-After time", async () => {
    signInEmail.mockImplementation(
      async (
        _body: unknown,
        options: { onError: (context: { response: Response }) => void },
      ) => {
        options.onError({
          response: new Response(null, {
            status: 429,
            headers: { "Retry-After": "240" },
          }),
        });
        return { data: null, error: { status: 429 } };
      },
    );
    await submit();
    const alert = await screen.findByText(
      "Too many sign-in attempts. Please try again in about 4 minutes.",
    );
    expect(alert.closest("[role=alert]")).toBeTruthy();
  });

  it("states the lock-out length", async () => {
    signInEmail.mockResolvedValue({
      data: null,
      error: { code: "ACCOUNT_LOCKED", status: 423 },
    });
    await submit();
    expect(
      await screen.findByText(/try again in up to 15 minutes/i),
    ).toBeTruthy();
  });

  it.each([
    [30, "30 seconds"],
    [1, "1 second"],
    [61, "about 2 minutes"],
    [null, "up to 15 minutes"],
  ])("describes a %s second wait as %s", (seconds, text) => {
    expect(describeWait(seconds, 15 * 60_000)).toBe(text);
  });
});
