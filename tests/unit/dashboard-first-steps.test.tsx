// @vitest-environment happy-dom
/**
 * IMP-083: the dashboard offers first steps, hides an empty activity box so
 * the cards use the width, and cards without a preview show the initial.
 */

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn());
const feed = vi.hoisted(() => ({ hasActivity: true }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));
// "Something old" (IMP-097) has its own tests.
vi.mock("@/features/dashboard/components/SomethingOldCard", () => ({
  SomethingOldCard: () => null,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-canvases", () => ({
  canvasKeys: { all: ["canvases"] },
  useCanvases: () => ({
    data: {
      pages: [
        {
          canvases: [
            {
              id: "c1",
              name: "garden plans",
              updatedAt: new Date().toISOString(),
              thumbnailKey: null,
            },
          ],
          pagination: { total: 1 },
        },
      ],
    },
    isLoading: false,
    error: null,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  }),
  useCreateCanvas: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/use-workspaces", () => ({
  useWorkspace: () => ({ data: undefined }),
}));
vi.mock("@/lib/theme-context", () => ({
  useThemeMode: () => ({ mode: "light", toggleTheme: vi.fn() }),
}));
vi.mock("@/features/dashboard/components/ActivityFeed", () => ({
  ActivityFeed: ({
    onHasActivity,
  }: {
    onHasActivity?: (has: boolean) => void;
  }) => {
    React.useEffect(() => onHasActivity?.(feed.hasActivity), [onHasActivity]);
    return <div>Recent activity</div>;
  },
}));
vi.mock("@/components/GlobalSearchDialog", () => ({
  GlobalSearchDialog: () => null,
}));
vi.mock("@/components/CommandPalette", () => ({
  CommandPalette: () => null,
}));
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: () => null,
}));

import { DashboardContent } from "@/features/dashboard/components/DashboardContent";
import { placeholderFor } from "@/features/dashboard/components/CanvasCard";
import { normalizeLink } from "@/features/dashboard/components/StarterRow";

beforeEach(() => {
  push.mockReset();
  feed.hasActivity = true;
});
afterEach(cleanup);

describe("dashboard first steps", () => {
  it("offers a blank canvas, saving a link and the Inbox", () => {
    render(<DashboardContent />);
    const starters = screen.getByRole("navigation", { name: "Get started" });
    expect(
      Array.from(starters.querySelectorAll("a, button")).map(
        (element) => element.textContent,
      ),
    ).toEqual([
      expect.stringContaining("Blank canvas"),
      expect.stringContaining("Save a link"),
      expect.stringContaining("Open Inbox"),
    ]);
    expect(
      screen.getByRole("link", { name: /Open Inbox/ }).getAttribute("href"),
    ).toBe("/inbox");
    expect(starters.textContent).not.toMatch(/template|duplicate/i);
  });

  it("sends a saved link to the share page, which saves it to the Inbox", async () => {
    render(<DashboardContent />);
    fireEvent.click(screen.getByRole("button", { name: /Save a link/ }));
    fireEvent.change(screen.getByLabelText(/Web address/), {
      target: { value: "example.com/read-later" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    expect(push).toHaveBeenCalledWith(
      "/share-target?url=https%3A%2F%2Fexample.com%2Fread-later",
    );
  });

  it("refuses something that is not a web address", async () => {
    render(<DashboardContent />);
    fireEvent.click(screen.getByRole("button", { name: /Save a link/ }));
    fireEvent.change(screen.getByLabelText(/Web address/), {
      target: { value: "not a link" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter a web address/)).toBeTruthy();
  });

  it("hides the activity box when there is no activity", () => {
    feed.hasActivity = false;
    render(<DashboardContent />);
    expect(screen.queryByTestId("activity-feed-panel")).toBeNull();
  });

  it("keeps the activity box when there is activity", () => {
    render(<DashboardContent />);
    expect(screen.getByTestId("activity-feed-panel")).toBeTruthy();
  });

  it("shows the canvas initial when there is no preview", () => {
    render(<DashboardContent />);
    expect(screen.getByTestId("canvas-card-placeholder").textContent).toBe("G");
  });
});

describe("helpers", () => {
  it("picks a stable placeholder colour and initial", () => {
    expect(placeholderFor("garden plans")).toEqual(
      placeholderFor("garden plans"),
    );
    expect(placeholderFor("  über").initial).toBe("Ü");
    expect(placeholderFor("").initial).toBe("?");
  });

  it.each([
    ["example.com", "https://example.com/"],
    ["http://a.example/x", "http://a.example/x"],
    ["javascript:alert(1)", null],
    ["localhost", null],
    ["", null],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeLink(input)).toBe(expected);
  });
});
