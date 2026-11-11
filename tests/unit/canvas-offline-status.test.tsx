// @vitest-environment happy-dom
/**
 * IMP-045: what the canvas header says about offline edits, whose device
 * copies a canvas may open, and what the accessible item list shows offline.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const auth = vi.hoisted(() => ({
  session: {
    data: null as { user: { id: string } } | null,
    error: null as unknown,
    isPending: true,
  },
}));
const store = vi.hoisted(() => ({
  owner: "user-stored" as string | null,
  claimed: [] as string[],
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => auth.session,
}));
vi.mock("@/lib/collaboration/sync/offline-store", () => ({
  claimOfflineCache: async (userId: string) => {
    store.claimed.push(userId);
  },
  readOfflineCacheOwner: async () => store.owner,
}));

import {
  describeSaveStatus,
  documentSaveStatus,
} from "@/features/canvas/save-status";
import { useOfflineCacheOwner } from "@/features/canvas/hooks/use-offline-cache-owner";
import { CanvasAccessiblePanel } from "@/features/canvas/components/CanvasAccessiblePanel";
import { CanvasDocumentContext } from "@/lib/hooks/use-canvas-document";
import { canvasItemKeys } from "@/lib/hooks/use-canvas-items";
import type {
  CanvasDocumentSession,
  CanvasDocumentSnapshot,
} from "@/lib/collaboration/sync/client-session";
import type { CanvasItemState } from "@/lib/collaboration/sync/document-items";
import { ItemType, resolveCanvasCapabilities } from "@/types/canvas";

const idle = {
  ready: true,
  forbidden: false,
  connected: true,
  restored: false,
  localChanges: false,
  pendingChanges: 0,
  unsavedChanges: 0,
};

describe("documentSaveStatus", () => {
  it("says nothing before the document renders or after access is lost", () => {
    expect(documentSaveStatus({ ...idle, ready: false })).toBeUndefined();
    expect(
      documentSaveStatus({ ...idle, forbidden: true, unsavedChanges: 2 }),
    ).toBeUndefined();
    expect(documentSaveStatus(idle)).toBeUndefined();
  });

  it("is offline while edits or the device copy are shown without a connection", () => {
    expect(
      documentSaveStatus({ ...idle, connected: false, unsavedChanges: 3 }),
    ).toBe("offline/retrying");
    expect(
      documentSaveStatus({ ...idle, connected: false, restored: true }),
    ).toBe("offline/retrying");
    expect(
      documentSaveStatus({ ...idle, connected: false, localChanges: true }),
    ).toBe("offline/retrying");
  });

  it("is saving until the server stored every edit, then saved", () => {
    expect(documentSaveStatus({ ...idle, unsavedChanges: 2 })).toBe("saving");
    expect(
      documentSaveStatus({ ...idle, localChanges: true, pendingChanges: 1 }),
    ).toBe("saving");
    expect(documentSaveStatus({ ...idle, localChanges: true })).toBe("saved");
  });
});

describe("describeSaveStatus", () => {
  it("counts the edits kept on this device", () => {
    expect(
      describeSaveStatus("offline/retrying", { offlineChanges: 3 }).label,
    ).toBe("Offline · 3 unsaved changes");
    expect(
      describeSaveStatus("offline/retrying", { offlineChanges: 1 }),
    ).toEqual({
      label: "Offline · 1 unsaved change",
      tooltip:
        "Offline. 1 change is kept on this device and will sync when you reconnect.",
    });
    expect(
      describeSaveStatus("offline/retrying", { offlineChanges: 0 }).label,
    ).toBe("Offline");
  });

  it("says edits are only in this tab when the device copy failed", () => {
    const failed = describeSaveStatus("offline/retrying", {
      offlineChanges: 2,
      deviceCopyFailed: true,
    });
    expect(failed.label).toBe("Offline · 2 unsaved changes");
    expect(failed.tooltip).not.toMatch(/kept on this device/);
    expect(failed.tooltip).toBe(
      "Offline. 2 changes could not be stored on this device and are held only in this tab until you reconnect. Keep this tab open.",
    );
    expect(
      describeSaveStatus("offline/retrying", {
        offlineChanges: 1,
        deviceCopyFailed: true,
      }).tooltip,
    ).toBe(
      "Offline. 1 change could not be stored on this device and is held only in this tab until you reconnect. Keep this tab open.",
    );
    const none = describeSaveStatus("offline/retrying", {
      offlineChanges: 0,
      deviceCopyFailed: true,
    });
    expect(none.label).toBe("Offline");
    expect(none.tooltip).not.toMatch(/kept (on this device|here)/);
    expect(none.tooltip).toMatch(/only in this tab/);
    // Other statuses, and the HTTP wording, do not change.
    expect(
      describeSaveStatus("saved", {
        offlineChanges: 2,
        deviceCopyFailed: true,
      }),
    ).toEqual(describeSaveStatus("saved"));
    expect(
      describeSaveStatus("offline/retrying", { deviceCopyFailed: true }),
    ).toEqual(describeSaveStatus("offline/retrying"));
  });

  it("keeps the HTTP wording when the document is not the source", () => {
    expect(describeSaveStatus("offline/retrying").label).toBe(
      "Offline · retrying",
    );
    expect(describeSaveStatus("saved", { offlineChanges: 4 }).label).toBe(
      "Saved",
    );
  });
});

describe("useOfflineCacheOwner", () => {
  beforeEach(() => {
    auth.session = { data: null, error: null, isPending: true };
    store.owner = "user-stored";
    store.claimed = [];
  });
  afterEach(() => vi.clearAllMocks());

  it("waits while the session is loading", () => {
    const { result } = renderHook(() => useOfflineCacheOwner());
    expect(result.current).toBeUndefined();
  });

  it("uses and claims the signed-in user", async () => {
    auth.session = {
      data: { user: { id: "user-a" } },
      error: null,
      isPending: false,
    };
    const { result } = renderHook(() => useOfflineCacheOwner());
    expect(result.current).toEqual({ userId: "user-a", confirmed: true });
    await waitFor(() => expect(store.claimed).toEqual(["user-a"]));
  });

  it("opens the last owner's copies when the session cannot be reached", async () => {
    auth.session = {
      data: null,
      error: new TypeError("Failed to fetch"),
      isPending: false,
    };
    const { result } = renderHook(() => useOfflineCacheOwner());
    await waitFor(() =>
      expect(result.current).toEqual({
        userId: "user-stored",
        confirmed: false,
      }),
    );
    expect(store.claimed).toEqual([]);
  });

  it("opens no copy when the server says nobody is signed in", () => {
    auth.session = {
      data: null,
      error: { status: 401 },
      isPending: false,
    };
    const { result } = renderHook(() => useOfflineCacheOwner());
    expect(result.current).toEqual({ userId: null, confirmed: true });

    auth.session = { data: null, error: null, isPending: false };
    const signedOut = renderHook(() => useOfflineCacheOwner());
    expect(signedOut.result.current).toEqual({
      userId: null,
      confirmed: true,
    });
  });

  it("keeps its answer while the session is fetched again", async () => {
    auth.session = {
      data: null,
      error: new TypeError("Failed to fetch"),
      isPending: false,
    };
    const { result, rerender } = renderHook(() => useOfflineCacheOwner());
    await waitFor(() => expect(result.current?.userId).toBe("user-stored"));

    auth.session = { data: null, error: null, isPending: true };
    rerender();
    expect(result.current).toEqual({ userId: "user-stored", confirmed: false });
  });
});

describe("accessible item list offline", () => {
  const CANVAS_ID = "ckcanvas000000000000000001";

  function textItem(id: string, text: string): CanvasItemState {
    return {
      id,
      type: ItemType.TEXT,
      positionX: 0,
      positionY: 0,
      width: 100,
      height: 40,
      zIndex: 0,
      tags: [],
      content: { text },
    };
  }

  function renderPanel(snapshot: Partial<CanvasDocumentSnapshot>) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(
      [...canvasItemKeys.list(CANVAS_ID), "accessible"],
      {
        pages: [
          {
            items: [
              {
                ...textItem("crow", "Row from the server"),
                canvasId: CANVAS_ID,
                version: 1,
              },
            ],
            total: 1,
            hasMore: false,
          },
        ],
        pageParams: [null],
      },
    );
    const full: CanvasDocumentSnapshot = {
      ready: true,
      writable: true,
      connected: true,
      pendingChanges: 0,
      unsavedChanges: 0,
      restored: false,
      canvasName: null,
      localChanges: false,
      forbidden: false,
      generation: 0,
      accessRevision: 0,
      items: new Map([
        [
          "cdoc",
          { state: textItem("cdoc", "Kept on this device"), changedAt: null },
        ],
      ]),
      ...snapshot,
    };
    const session = {
      canvasId: CANVAS_ID,
      subscribe: () => () => {},
      getSnapshot: () => full,
    } as unknown as CanvasDocumentSession;
    return render(
      <QueryClientProvider client={queryClient}>
        <CanvasDocumentContext.Provider value={session}>
          <CanvasAccessiblePanel
            canvasId={CANVAS_ID}
            capabilities={resolveCanvasCapabilities("EDIT")}
            canvasName="Plans"
          />
        </CanvasDocumentContext.Provider>
      </QueryClientProvider>,
    );
  }

  afterEach(() => cleanup());

  it("lists the server's rows while connected", () => {
    renderPanel({});
    expect(screen.getByLabelText("text: Row from the server")).toBeTruthy();
    expect(screen.queryByLabelText("text: Kept on this device")).toBeNull();
  });

  it("lists the document's items while offline", () => {
    renderPanel({ connected: false });
    expect(screen.getByLabelText("text: Kept on this device")).toBeTruthy();
    expect(screen.queryByLabelText("text: Row from the server")).toBeNull();
  });
});
