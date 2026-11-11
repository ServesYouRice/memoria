// @vitest-environment happy-dom
/**
 * TASK-039 — EditBookmarkDialog submits metadata only for the URL it belongs
 * to: an edited URL saved without re-fetching drops the old URL's metadata.
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

const hooks = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock("@/lib/hooks/use-canvas-items", () => ({
  useUpdateCanvasItem: () => ({ mutateAsync: hooks.mutateAsync }),
}));

import { EditBookmarkDialog } from "@/features/canvas/components/EditBookmarkDialog";
import type { CanvasItem } from "@/types/canvas";

const OLD_URL = "https://old.example.com/page";
const NEW_URL = "https://new.example.com/other";
const OLD_UNFURLED_AT = "2026-01-01T00:00:00.000Z";

const item = {
  id: "item-1",
  canvasId: "canvas-1",
  type: "BOOKMARK",
  positionX: 0,
  positionY: 0,
  width: 300,
  height: 200,
  zIndex: 0,
  version: 4,
  tags: ["keep"],
  content: {
    url: OLD_URL,
    title: "Old title",
    description: "Old description",
    favicon: "https://old.example.com/favicon.ico",
    previewImage: "https://old.example.com/og.png",
    siteName: "Old site",
    unfurledAt: OLD_UNFURLED_AT,
    summary: "Old summary",
  },
} as unknown as CanvasItem;

function renderDialog() {
  return render(
    <EditBookmarkDialog open onClose={() => undefined} item={item} />,
  );
}

function urlInput() {
  return screen.getByLabelText(/URL/) as HTMLInputElement;
}

async function submitted() {
  fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
  await waitFor(() => expect(hooks.mutateAsync).toHaveBeenCalledTimes(1));
  return hooks.mutateAsync.mock.calls[0][0].data.content as Record<
    string,
    unknown
  >;
}

describe("EditBookmarkDialog metadata", () => {
  beforeEach(() => {
    hooks.mutateAsync.mockReset();
    hooks.mutateAsync.mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("drops the old URL's metadata when the URL changes without a re-fetch", async () => {
    renderDialog();
    await waitFor(() => expect(urlInput().value).toBe(OLD_URL));
    fireEvent.change(urlInput(), { target: { value: NEW_URL } });

    const content = await submitted();
    expect(content.url).toBe(NEW_URL);
    for (const key of [
      "title",
      "description",
      "favicon",
      "previewImage",
      "siteName",
      "unfurledAt",
      "summary",
    ]) {
      expect(content[key]).toBeUndefined();
    }
    expect(screen.queryByText("Old title")).toBeNull();
  });

  it("keeps the existing metadata and unfurledAt when the URL is unchanged", async () => {
    renderDialog();
    await waitFor(() => expect(urlInput().value).toBe(OLD_URL));

    const content = await submitted();
    expect(content).toMatchObject({
      url: OLD_URL,
      title: "Old title",
      description: "Old description",
      siteName: "Old site",
      unfurledAt: OLD_UNFURLED_AT,
      summary: "Old summary",
    });
  });

  it("submits re-fetched metadata with a fresh unfurledAt for the current URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ title: "New title", siteName: "New site" }),
      })),
    );
    renderDialog();
    await waitFor(() => expect(urlInput().value).toBe(OLD_URL));
    fireEvent.change(urlInput(), { target: { value: NEW_URL } });
    fireEvent.click(screen.getByRole("button", { name: /re-fetch metadata/i }));
    await screen.findByText("New title");

    const content = await submitted();
    expect(content).toMatchObject({
      url: NEW_URL,
      title: "New title",
      siteName: "New site",
    });
    expect(content.description).toBeUndefined();
    expect(content.unfurledAt).not.toBe(OLD_UNFURLED_AT);
    expect(typeof content.unfurledAt).toBe("string");
  });
});
