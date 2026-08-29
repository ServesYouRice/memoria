// @vitest-environment happy-dom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  useNotifications: vi.fn(),
  useMarkNotificationsRead: vi.fn(),
  useNotificationPreferences: vi.fn(),
  useUpdateNotificationPreference: vi.fn(),
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

vi.mock("@/lib/hooks/use-notifications", () => ({
  NOTIFICATION_TYPE_LABELS: {
    CANVAS_SHARED: "Canvas invitations",
    SHARE_INVITATION_ACCEPTED: "Accepted invitations",
    SHARE_INVITATION_DECLINED: "Declined invitations",
  },
  useNotifications: hookMocks.useNotifications,
  useMarkNotificationsRead: hookMocks.useMarkNotificationsRead,
  useNotificationPreferences: hookMocks.useNotificationPreferences,
  useUpdateNotificationPreference: hookMocks.useUpdateNotificationPreference,
}));

import { NotificationsContent } from "@/app/notifications/NotificationsContent";
import { NotificationPreferences } from "@/app/settings/NotificationPreferences";

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notification inbox", () => {
  it("shows unread state and wires bulk, individual, and invitation actions", () => {
    const mutate = vi.fn();
    hookMocks.useMarkNotificationsRead.mockReturnValue({
      mutate,
      isPending: false,
      error: null,
    });
    hookMocks.useNotifications.mockReturnValue({
      data: {
        pages: [
          {
            unread: 1,
            notifications: [
              {
                id: "notification-1",
                type: "CANVAS_SHARED",
                subject: "Ada invited you to Roadmap",
                canvasId: "canvas-1",
                readAt: null,
                createdAt: new Date().toISOString(),
                actor: { id: "user-2", name: "Ada", image: null },
                canvas: { id: "canvas-1", name: "Roadmap" },
                action: {
                  href: "/share-invitations/raw-token",
                  label: "Review invitation",
                },
              },
            ],
          },
        ],
      },
      isLoading: false,
      error: null,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    });

    render(<NotificationsContent />);

    expect(screen.getByText("1 unread notification")).toBeTruthy();
    expect(screen.getByLabelText("Unread")).toBeTruthy();
    const invitation = screen.getByRole("link", {
      name: "Review invitation",
    });
    expect(invitation.getAttribute("href")).toBe(
      "/share-invitations/raw-token",
    );

    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark read" }));
    fireEvent.click(invitation);

    expect(mutate).toHaveBeenNthCalledWith(1, { all: true });
    expect(mutate).toHaveBeenNthCalledWith(2, {
      ids: ["notification-1"],
    });
    expect(mutate).toHaveBeenNthCalledWith(3, {
      ids: ["notification-1"],
    });
  });
});

describe("notification preferences", () => {
  it("persists channel changes without altering the other channel", () => {
    const mutate = vi.fn();
    hookMocks.useNotificationPreferences.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        preferences: [
          {
            type: "CANVAS_SHARED",
            inAppEnabled: true,
            emailEnabled: true,
          },
        ],
      },
    });
    hookMocks.useUpdateNotificationPreference.mockReturnValue({
      mutate,
      isPending: false,
      variables: undefined,
      error: null,
    });

    render(<NotificationPreferences />);

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Canvas invitations email notifications",
      }),
    );

    expect(mutate).toHaveBeenCalledWith({
      type: "CANVAS_SHARED",
      inAppEnabled: true,
      emailEnabled: false,
    });
  });
});
