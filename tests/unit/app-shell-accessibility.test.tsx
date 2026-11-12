// @vitest-environment happy-dom

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
  unread: 3,
  signedIn: true,
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

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    data: navigationMocks.signedIn
      ? { user: { name: "Ada", email: "ada@example.com", image: null } }
      : null,
    isPending: false,
  }),
  signOutAndRedirect: vi.fn(),
}));

vi.mock("@/lib/hooks/use-notifications", () => ({
  useUnreadNotifications: () => ({ data: navigationMocks.unread }),
}));

vi.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">Toggle theme</button>,
}));

import { AppShell } from "@/components/layout/AppShell";
import { PublicInfoPage } from "@/components/layout/PublicInfoPage";

afterEach(() => {
  cleanup();
  navigationMocks.push.mockReset();
  navigationMocks.unread = 3;
  navigationMocks.signedIn = true;
});

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

  it("renders no badge when nothing is unread", () => {
    navigationMocks.unread = 0;
    const { container } = render(
      <AppShell>
        <h1>Dashboard content</h1>
      </AppShell>,
    );

    const bell = screen.getByRole("link", { name: "Notifications" });
    expect(bell.querySelector(".MuiBadge-badge")).toBeNull();
    expect(container.textContent).not.toMatch(/\b0\b/);
  });

  it("caps a large unread count at 99+", () => {
    navigationMocks.unread = 150;
    render(
      <AppShell>
        <h1>Dashboard content</h1>
      </AppShell>,
    );

    const bell = screen.getByRole("link", {
      name: "Notifications, 150 unread",
    });
    expect(bell.querySelector(".MuiBadge-badge")?.textContent).toBe("99+");
  });

  it("keeps the shared outer width and narrows only an inner column", () => {
    render(
      <AppShell readingWidth="md">
        <h1>Settings</h1>
      </AppShell>,
    );

    const main = screen.getByRole("main");
    expect(main.className).toContain("MuiContainer-maxWidthLg");
    const column = within(main).getByTestId("reading-column");
    expect(
      within(column).getByRole("heading", { name: "Settings" }),
    ).toBeTruthy();
  });
});

describe("public information pages", () => {
  it("show the normal app top bar to signed-in users", () => {
    render(
      <PublicInfoPage title="Help" description="Guidance">
        <p>Body</p>
      </PublicInfoPage>,
    );

    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 1, name: "Help" }),
    ).toBeTruthy();
  });

  it("show the logo and Sign in to visitors without requiring a session", () => {
    navigationMocks.signedIn = false;
    render(
      <PublicInfoPage title="Help" description="Guidance">
        <p>Body</p>
      </PublicInfoPage>,
    );

    expect(
      screen.queryByRole("navigation", { name: "Primary navigation" }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    ).toBe("/auth/login");
    expect(screen.getByRole("main").textContent).toContain("Body");
  });
});

describe("top bar search (IMP-083)", () => {
  it("shows a search field with its shortcut that opens search", () => {
    render(
      <AppShell>
        <h1>Dashboard content</h1>
      </AppShell>,
    );
    const field = document.querySelector<HTMLElement>(
      '[aria-keyshortcuts="Control+K Meta+K"]',
    )!;
    expect(field.getAttribute("aria-label")).toBe("Search");
    expect(field.textContent).toMatch(/Search…/);
    expect(field.textContent).toMatch(/(Ctrl|⌘) K/);
    fireEvent.click(field);
    expect(navigationMocks.push).toHaveBeenCalledWith("/search");
  });

  it("opens search on Ctrl+K unless the page already handled it", () => {
    render(
      <AppShell>
        <h1>Dashboard content</h1>
      </AppShell>,
    );
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(navigationMocks.push).toHaveBeenCalledWith("/search");

    navigationMocks.push.mockReset();
    const handled = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      cancelable: true,
    });
    handled.preventDefault();
    window.dispatchEvent(handled);
    expect(navigationMocks.push).not.toHaveBeenCalled();
  });
});
