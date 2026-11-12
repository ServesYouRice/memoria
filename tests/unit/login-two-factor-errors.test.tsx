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
const verifyTotp = vi.hoisted(() => vi.fn());
const verifyBackupCode = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { email: signInEmail, passkey: vi.fn() },
    twoFactor: { verifyTotp, verifyBackupCode },
  },
}));

import {
  LoginForm,
  secondFactorErrorMessage,
} from "@/features/auth/components/LoginForm";

class StubIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const RATE_LIMITED = "Too many attempts. Please try again in up to 15 minutes.";

beforeEach(() => {
  signInEmail.mockReset();
  verifyTotp.mockReset();
  verifyBackupCode.mockReset();
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function reachSecondFactor() {
  signInEmail.mockResolvedValue({
    data: { twoFactorRedirect: true },
    error: null,
  });
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

describe("two-factor step errors", () => {
  it.each([
    ["authenticator code", verifyTotp, "123456"],
    ["backup code", verifyBackupCode, "ABCDE-12345"],
  ])(
    "shows a rate-limit message on 429 for a %s",
    async (_kind, verify, code) => {
      verify.mockResolvedValue({
        data: null,
        error: { status: 429, message: "Too Many Requests" },
      });
      await reachSecondFactor();
      if (verify === verifyBackupCode) {
        fireEvent.click(
          screen.getByRole("button", { name: "Use a backup code instead" }),
        );
      }
      fireEvent.change(
        screen.getByLabelText(
          verify === verifyBackupCode ? "Backup code" : "Authentication code",
          { exact: false },
        ),
        { target: { value: code } },
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Verify" }));
      });

      expect(verify).toHaveBeenCalledTimes(1);
      expect(screen.getByText(RATE_LIMITED)).toBeTruthy();
      expect(screen.queryByText(/code is not valid/)).toBeNull();
      // Still on the two-factor step.
      expect(screen.getByRole("button", { name: "Verify" })).toBeTruthy();
    },
  );

  it("keeps the existing code messages", () => {
    expect(secondFactorErrorMessage({ code: "ACCOUNT_LOCKED" })).toMatch(
      /temporarily locked/,
    );
    expect(
      secondFactorErrorMessage({ code: "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE" }),
    ).toBe(
      "This sign-in attempt expired. Enter your email and password again.",
    );
    expect(
      secondFactorErrorMessage({ code: "INVALID_TWO_FACTOR_COOKIE" }),
    ).toBe(
      "This sign-in attempt expired. Enter your email and password again.",
    );
    expect(secondFactorErrorMessage({ code: "INVALID_BACKUP_CODE" })).toBe(
      "That backup code is not valid.",
    );
    expect(secondFactorErrorMessage({ code: "INVALID_CODE" })).toBe(
      "That code is not valid. Check your authenticator app and try again.",
    );
    expect(secondFactorErrorMessage({ status: 429 })).toBe(RATE_LIMITED);
    expect(secondFactorErrorMessage({ status: 429 }, 90)).toBe(
      "Too many attempts. Please try again in about 2 minutes.",
    );
  });
});
