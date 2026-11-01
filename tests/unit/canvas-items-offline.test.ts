// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("@/lib/api/fetch-client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const { listItemsOrOfflinePlaceholder } =
  await import("@/lib/hooks/use-canvas-items");

function setOnline(online: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
}

describe("listItemsOrOfflinePlaceholder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    apiFetch.mockReset();
  });

  it("returns an empty placeholder page when the network is gone", async () => {
    setOnline(false);
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(
      listItemsOrOfflinePlaceholder("canvas-1"),
    ).resolves.toMatchObject({
      items: [],
      total: 0,
      hasMore: false,
      offlinePlaceholder: true,
    });
  });

  it("still throws network errors while online", async () => {
    setOnline(true);
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(listItemsOrOfflinePlaceholder("canvas-1")).rejects.toThrow(
      "Failed to fetch",
    );
  });

  it("still throws server errors while offline", async () => {
    setOnline(false);
    apiFetch.mockRejectedValue(new Error("Forbidden"));
    await expect(listItemsOrOfflinePlaceholder("canvas-1")).rejects.toThrow(
      "Forbidden",
    );
  });
});
