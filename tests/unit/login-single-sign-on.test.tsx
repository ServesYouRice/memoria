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

const signInSocial = vi.hoisted(() => vi.fn());
const params = vi.hoisted(() => ({ value: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => params.value,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { email: vi.fn(), passkey: vi.fn(), social: signInSocial },
  },
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
  signInSocial.mockReset();
  params.value = new URLSearchParams();
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Sign in with an existing login system (IMP-099)", () => {
  it("shows no extra button without the settings", () => {
    render(<LoginForm />);
    expect(screen.queryByRole("button", { name: /Sign in with/ })).toBeNull();
  });

  it("starts the login system's sign-in and comes back to the asked page", async () => {
    params.value = new URLSearchParams({ callbackUrl: "/canvas/abc" });
    signInSocial.mockResolvedValue({ data: { url: "https://login" } });
    render(<LoginForm ssoLabel="Home Login" />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Sign in with Home Login" }),
      );
    });
    expect(signInSocial).toHaveBeenCalledWith({
      provider: "oidc",
      callbackURL: "/canvas/abc",
      errorCallbackURL: "/auth/login",
    });
  });

  it("explains a refusal from the login system in plain words", () => {
    params.value = new URLSearchParams({ error: "signup_disabled" });
    render(<LoginForm ssoLabel="Home Login" />);
    expect(screen.getByRole("alert").textContent).toContain(
      "There is no Memoria account for this login yet",
    );
  });
});
