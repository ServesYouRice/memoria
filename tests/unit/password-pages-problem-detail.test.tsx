// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("token=reset-token"),
}));

import ResetPasswordPage from "@/app/auth/reset-password/page";
import ForgotPasswordPage from "@/app/auth/forgot-password/page";

function problem(body: Record<string, unknown>, status = 400) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function submitReset() {
  render(<ResetPasswordPage />);
  fireEvent.change(await screen.findByLabelText(/^new password/i), {
    target: { value: "correct horse battery" },
  });
  fireEvent.change(screen.getByLabelText(/confirm/i), {
    target: { value: "correct horse battery" },
  });
  fireEvent.click(screen.getByRole("button", { name: /reset password/i }));
}

async function submitForgot() {
  render(<ForgotPasswordPage />);
  fireEvent.change(screen.getByLabelText(/email/i), {
    target: { value: "person@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
}

describe("password pages show the server's problem detail", () => {
  it("reset page shows the problem detail", async () => {
    fetchMock.mockResolvedValue(
      problem({
        title: "Bad Request",
        status: 400,
        detail: "Reset token has expired",
      }),
    );
    await submitReset();
    expect(await screen.findByText("Reset token has expired")).toBeTruthy();
  });

  it("reset page falls back to the title, then the generic text", async () => {
    fetchMock.mockResolvedValue(
      problem({ title: "Too Many Requests", status: 429 }, 429),
    );
    await submitReset();
    expect(await screen.findByText("Too Many Requests")).toBeTruthy();
  });

  it("reset page shows the generic text for a non-JSON body", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>bad gateway</html>", { status: 502 }),
    );
    await submitReset();
    expect(await screen.findByText("Failed to reset password")).toBeTruthy();
  });

  it("forgot page shows the problem detail", async () => {
    fetchMock.mockResolvedValue(
      problem(
        {
          title: "Too Many Requests",
          status: 429,
          detail: "Try again in a minute",
        },
        429,
      ),
    );
    await submitForgot();
    expect(await screen.findByText("Try again in a minute")).toBeTruthy();
  });

  it("forgot page shows the generic text for a non-JSON body", async () => {
    fetchMock.mockResolvedValue(new Response("oops", { status: 500 }));
    await submitForgot();
    expect(await screen.findByText("Failed to send reset email")).toBeTruthy();
  });
});
