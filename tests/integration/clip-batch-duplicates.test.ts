import { randomBytes } from "crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as MutationLock from "@/lib/canvas/mutation-lock";

vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));

const barrier = vi.hoisted(() => ({
  expected: 0,
  arrived: 0,
  release: null as null | (() => void),
}));

// Holds every caller at the Inbox lock until all concurrent batches have done
// their unlocked work, so the race is deterministic.
vi.mock("@/lib/canvas/mutation-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof MutationLock>();
  return {
    ...actual,
    lockCanvasForMutation: async (
      ...args: Parameters<typeof actual.lockCanvasForMutation>
    ) => {
      if (barrier.expected > 0) {
        barrier.arrived += 1;
        if (barrier.arrived >= barrier.expected) {
          barrier.expected = 0;
          barrier.release?.();
        } else {
          await Promise.race([
            new Promise<void>((resolve) => {
              barrier.release = resolve;
            }),
            new Promise((resolve) => setTimeout(resolve, 3_000)),
          ]);
        }
      }
      return actual.lockCanvasForMutation(...args);
    },
  };
});

import { prisma } from "@/lib/db";
import { ClipBatchSource, saveClipBatch } from "@/lib/services/clip-batch";
import { normalizeLinkUrl } from "@/lib/services/duplicates";

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  barrier.expected = 0;
  barrier.arrived = 0;
  barrier.release = null;
});

async function createUserWithInbox() {
  const user = await prisma.user.create({
    data: {
      email: `clip-dup-${randomBytes(6).toString("hex")}@example.com`,
      autoEnrichLinks: false,
    },
  });
  const inbox = await prisma.canvas.create({
    data: { userId: user.id, name: "Inbox" },
  });
  return { user, inbox };
}

function batch(userId: string, links: { url: string; title?: string }[]) {
  return saveClipBatch({
    userId,
    source: ClipBatchSource.EXTENSION,
    data: {
      idempotencyKey: `dup-${randomBytes(6).toString("hex")}`,
      skipDuplicates: true,
      links,
    },
  });
}

function savedCount(canvasId: string, url: string) {
  return prisma.canvasItem.count({
    where: {
      canvasId,
      deletedAt: null,
      normalizedUrl: normalizeLinkUrl(url),
    },
  });
}

function accountedFor(result: Awaited<ReturnType<typeof saveClipBatch>>) {
  return (
    result.itemIds.length +
    result.duplicates.filter(
      (entry) => entry.savedItemId === null && entry.existing.length > 0,
    ).length
  );
}

describe("clip batch duplicate skipping (VAL-274)", () => {
  it("saves a new URL once when two batches race with different keys", async () => {
    const { user, inbox } = await createUserWithInbox();
    const url = "https://example.com/race";
    barrier.expected = 2;

    const results = await Promise.all([
      batch(user.id, [{ url, title: "One" }]),
      batch(user.id, [{ url: `${url}?utm_source=x`, title: "Two" }]),
    ]);

    expect(await savedCount(inbox.id, url)).toBe(1);
    for (const result of results) expect(accountedFor(result)).toBe(1);
    expect(results.flatMap((result) => result.itemIds)).toHaveLength(1);
  });

  it("saves a URL repeated within one batch once and points the repeat at it", async () => {
    const { user, inbox } = await createUserWithInbox();
    const data = {
      idempotencyKey: `dup-${randomBytes(6).toString("hex")}`,
      skipDuplicates: true,
      links: [
        { url: "https://example.com/a", title: "A" },
        { url: "https://example.com/b" },
        { url: "https://example.com/a/#section", title: "A again" },
      ],
    };
    const send = () =>
      saveClipBatch({
        userId: user.id,
        source: ClipBatchSource.EXTENSION,
        data,
      });
    const result = await send();

    expect(await savedCount(inbox.id, "https://example.com/a")).toBe(1);
    expect(result.itemIds).toHaveLength(2);
    expect(accountedFor(result)).toBe(3);
    expect(result.duplicates).toEqual([
      {
        index: 2,
        url: "https://example.com/a/#section",
        savedItemId: null,
        existing: [
          expect.objectContaining({
            itemId: result.itemIds[0],
            canvasId: inbox.id,
            path: `/canvas/${inbox.id}?item=${result.itemIds[0]}`,
          }),
        ],
      },
    ]);

    const replay = await send();
    expect(replay).toEqual({ ...result, replayed: true });
  });
});
