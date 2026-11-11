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

import { LoginForm } from "@/features/auth/components/LoginForm";

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
    [{ status: 429 }, "Too many sign-in attempts. Please wait and try again."],
    [
      { status: 401, code: "INVALID_EMAIL_OR_PASSWORD" },
      "Invalid email or password",
    ],
  ])("keeps the existing message for %o", async (error, message) => {
    signInEmail.mockResolvedValue({ data: null, error });
    await submit();
    expect(await screen.findByText(message)).toBeTruthy();
  });
});
