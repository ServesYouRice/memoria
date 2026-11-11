// @vitest-environment happy-dom
/**
 * TASK-047 — ShareDialog lists pending invitations from GET /share and lets
 * the owner revoke them through DELETE /share/{invitationId}.
 */

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock("@/stores/confirmStore", () => ({
  confirmDialog: vi.fn(async () => true),
}));
vi.mock("@/features/canvas/components/EmbedManager", () => ({
  EmbedManager: () => null,
}));

import { ShareDialog } from "@/features/canvas/components/ShareDialog";

const CANVAS = "canvas-1";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let invitations: Array<Record<string, unknown>>;

beforeEach(() => {
  invitations = [
    {
      id: "inv-1",
      email: "pending@example.com",
      role: "EDIT",
      expiresAt: "2026-12-01T00:00:00.000Z",
      createdAt: "2026-11-01T00:00:00.000Z",
    },
  ];
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === `/api/v1/canvases/${CANVAS}/share` && method === "GET") {
        return json({ shares: [], invitations });
      }
      if (url === `/api/v1/canvases/${CANVAS}`) {
        return json({ canvas: { isPublic: false } });
      }
      if (
        url === `/api/v1/canvases/${CANVAS}/share/inv-1` &&
        method === "DELETE"
      ) {
        invitations = [];
        return json({ success: true });
      }
      return json({}, 404);
    },
  );
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ShareDialog pending invitations", () => {
  it("lists pending invitations with email and role", async () => {
    render(
      <ShareDialog
        open
        onClose={() => undefined}
        canvasId={CANVAS}
        canvasName="Board"
      />,
    );
    expect(await screen.findByText("pending@example.com")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Revoke invitation for pending@example.com",
      }),
    ).toBeTruthy();
  });

  it("revokes an invitation by its id and reloads the list", async () => {
    render(
      <ShareDialog
        open
        onClose={() => undefined}
        canvasId={CANVAS}
        canvasName="Board"
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Revoke invitation for pending@example.com",
      }),
    );
    await waitFor(() =>
      expect(mocks.fetch).toHaveBeenCalledWith(
        `/api/v1/canvases/${CANVAS}/share/inv-1`,
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText("pending@example.com")).toBeNull(),
    );
  });
});
