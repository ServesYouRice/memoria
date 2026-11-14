// @vitest-environment happy-dom
/**
 * IMP-134 — one search: Ctrl/Cmd+K opens the Search page from every page
 * with the app shell, and on that page puts the cursor in its field. The
 * Search page hands a typed query to Ask without sending it.
 */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/dashboard",
  push: vi.fn(),
  replace: vi.fn(),
  apiFetch: vi.fn(),
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
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    data: { user: { name: "Ada", email: "ada@example.com", image: null } },
    isPending: false,
  }),
  signOutAndRedirect: vi.fn(),
}));
vi.mock("@/lib/hooks/use-notifications", () => ({
  useUnreadNotifications: () => ({ data: 0 }),
}));
vi.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">Toggle theme</button>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api/fetch-client", () => ({ apiFetch: mocks.apiFetch }));
vi.mock("@/lib/hooks/use-agent-control", () => ({
  useApproveSuggestion: () => ({ mutateAsync: vi.fn() }),
  useExecuteSuggestion: () => ({ mutateAsync: vi.fn() }),
  useRejectSuggestion: () => ({ mutateAsync: vi.fn() }),
  useRevertChangeSet: () => ({ mutateAsync: vi.fn() }),
}));

import { AppShell } from "@/components/layout/AppShell";
import { SearchContent } from "@/app/search/SearchContent";
import { SEARCH_INPUT_ID } from "@/app/search/search-input-id";

function renderShell(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AppShell>{children}</AppShell>
    </QueryClientProvider>,
  );
}

function pressCtrlK() {
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apiFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ canvases: [], workspaces: [] }),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ results: [] }))),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Ctrl/Cmd+K search shortcut", () => {
  it("opens the Search page from the dashboard", () => {
    mocks.pathname = "/dashboard";
    renderShell(<h1>My canvases</h1>);

    pressCtrlK();
    expect(mocks.push).toHaveBeenCalledWith("/search");

    mocks.push.mockClear();
    fireEvent.keyDown(window, { key: "K", metaKey: true });
    expect(mocks.push).toHaveBeenCalledWith("/search");
  });

  it("puts the cursor in the search field on the Search page", () => {
    mocks.pathname = "/search";
    renderShell(<SearchContent />);

    const field = document.getElementById(SEARCH_INPUT_ID)!;
    expect(field).toBeTruthy();
    field.blur();
    expect(document.activeElement).not.toBe(field);

    pressCtrlK();
    expect(document.activeElement).toBe(field);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("offers to ask AI about the typed words and opens Ask with them", async () => {
    mocks.pathname = "/search";
    renderShell(<SearchContent />);

    expect(screen.queryByRole("button", { name: /Ask AI about/ })).toBeNull();
    const asked: unknown[] = [];
    const onAsk = (event: Event) => asked.push((event as CustomEvent).detail);
    window.addEventListener("memoria:ask", onAsk);

    fireEvent.change(document.getElementById(SEARCH_INPUT_ID)!, {
      target: { value: "lisbon" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: 'Ask AI about "lisbon"' }),
    );
    window.removeEventListener("memoria:ask", onAsk);

    expect(asked).toEqual([{ question: "lisbon" }]);
    const box = (await screen.findByRole("textbox", {
      name: "Ask Memoria",
    })) as HTMLInputElement;
    expect(box.value).toBe("lisbon");
    // Typed, not sent: no question went to the AI.
    expect(
      mocks.apiFetch.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toBe(false);
  });
});
