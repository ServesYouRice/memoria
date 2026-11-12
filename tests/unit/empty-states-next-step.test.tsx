// @vitest-environment happy-dom
/**
 * IMP-089: an empty page says what will appear there and offers one next
 * step as a real, keyboard-reachable link.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { TrashContent } from "@/app/trash/TrashContent";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("empty Trash", () => {
  it("explains how long items are kept and links back to the dashboard", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          items: [],
          pagination: { offset: 0, limit: 50, hasMore: false },
        }),
      ),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TrashContent />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Trash is empty")).toBeTruthy();
    expect(
      screen.getByText(new RegExp(`${LAUNCH_LIMITS.trashRetentionDays} days`)),
    ).toBeTruthy();
    const next = screen.getByRole("link", { name: "Back to the dashboard" });
    expect(next.getAttribute("href")).toBe("/dashboard");
    expect(next.tabIndex).toBe(0);
  });
});
