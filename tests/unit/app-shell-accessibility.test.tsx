// @vitest-environment happy-dom

import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: React.forwardRef<HTMLAnchorElement, React.ComponentProps<"a">>(
    function Link({ children, href, ...props }, ref) {
      return (
        <a ref={ref} href={href} {...props}>
          {children}
        </a>
      );
    },
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: navigationMocks.push }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { name: "Ada", email: "ada@example.com", image: null } },
  }),
  signOut: vi.fn(),
}));

vi.mock("@/lib/hooks/use-notifications", () => ({
  useUnreadNotifications: () => ({ data: 3 }),
}));

vi.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">Toggle theme</button>,
}));

import { AppShell } from "@/components/layout/AppShell";

afterEach(cleanup);

describe("authenticated application shell", () => {
  it("exposes skip navigation, current-page state, and notification count", () => {
    render(
      <AppShell>
        <h1>Dashboard content</h1>
      </AppShell>,
    );

    const skipLink = screen.getByRole("link", {
      name: "Skip to main content",
    });
    expect(skipLink.getAttribute("href")).toBe("#main-content");
    expect(screen.getByRole("main").id).toBe("main-content");

    const primary = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    expect(
      within(primary)
        .getByRole("link", { name: /Dashboard/i })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: "Notifications, 3 unread" }),
    ).toBeTruthy();
  });
});
