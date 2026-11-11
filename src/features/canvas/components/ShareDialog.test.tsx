// @vitest-environment happy-dom
/**
 * TASK-115 — a public-status response that is older than the dialog's
 * current state never overwrites it, and the public controls wait for the
 * initial status.
 */

import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/stores/confirmStore", () => ({
  confirmDialog: vi.fn(async () => true),
}));
vi.mock("./EmbedManager", () => ({ EmbedManager: () => null }));

import { ShareDialog } from "./ShareDialog";

const CANVAS = "canvas-1";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let statusRequests: Array<(response: Response) => void>;

beforeEach(() => {
  statusRequests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/v1/canvases/${CANVAS}`) {
        return new Promise<Response>((resolve) => statusRequests.push(resolve));
      }
      if (url === `/api/v1/canvases/${CANVAS}/share`) {
        return json({ shares: [], invitations: [] });
      }
      return json({}, 404);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function publicSwitch() {
  return screen.getByLabelText(
    "Anyone with the link can view",
  ) as HTMLInputElement;
}

function dialog(open: boolean) {
  return (
    <ShareDialog
      open={open}
      onClose={() => undefined}
      canvasId={CANVAS}
      canvasName="Board"
    />
  );
}

describe("ShareDialog public status", () => {
  it("keeps the public switch disabled until the initial status loads", async () => {
    render(dialog(true));
    await waitFor(() => expect(statusRequests).toHaveLength(1));
    expect(publicSwitch().disabled).toBe(true);

    await act(async () => {
      statusRequests[0](json({ isPublic: false }));
    });
    await waitFor(() => expect(publicSwitch().disabled).toBe(false));
  });

  it("ignores a status response from before the dialog was closed and reopened", async () => {
    const view = render(dialog(true));
    await waitFor(() => expect(statusRequests).toHaveLength(1));
    view.rerender(dialog(false));
    view.rerender(dialog(true));
    await waitFor(() => expect(statusRequests).toHaveLength(2));

    await act(async () => {
      statusRequests[1](json({ isPublic: true, shareToken: "tok-new" }));
    });
    await waitFor(() => expect(publicSwitch().checked).toBe(true));

    // The first open's request, which saw the canvas private, lands last.
    await act(async () => {
      statusRequests[0](json({ isPublic: false }));
    });
    expect(publicSwitch().checked).toBe(true);
    expect(
      (screen.getByLabelText("Public share link") as HTMLInputElement).value,
    ).toContain("/share/tok-new");
  });
});
