/**
 * approve/reject are compare-and-set: a status change between their read and
 * their write (a concurrent claim, reject or execution) must win.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SuggestionStatus } from "@/generated/prisma/client";

type Row = {
  id: string;
  userId: string;
  status: SuggestionStatus;
  expiresAt: Date;
  actedAt: Date | null;
};

const store = vi.hoisted(() => ({
  row: null as unknown as Row,
  // Runs once after the first read, simulating a concurrent writer.
  afterFirstRead: null as null | (() => void),
}));

function matches(row: Row, where: Record<string, unknown>) {
  if (where.id !== undefined && where.id !== row.id) return false;
  if (where.userId !== undefined && where.userId !== row.userId) return false;
  const status = where.status as
    SuggestionStatus | { in: SuggestionStatus[] } | undefined;
  if (typeof status === "string" && status !== row.status) return false;
  if (status && typeof status === "object" && !status.in.includes(row.status))
    return false;
  const expiresAt = where.expiresAt as { gt: Date } | undefined;
  if (expiresAt && !(row.expiresAt > expiresAt.gt)) return false;
  return true;
}

vi.mock("@/lib/db", () => ({
  prisma: {
    suggestion: {
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          const snapshot = matches(store.row, where) ? { ...store.row } : null;
          const hook = store.afterFirstRead;
          store.afterFirstRead = null;
          hook?.();
          return snapshot;
        },
      ),
      update: vi.fn(
        async ({ data }: { where: unknown; data: Partial<Row> }) => {
          Object.assign(store.row, data);
          return { ...store.row };
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Partial<Row>;
        }) => {
          if (!matches(store.row, where)) return { count: 0 };
          Object.assign(store.row, data);
          return { count: 1 };
        },
      ),
    },
  },
}));

import {
  approveSuggestion,
  claimSuggestionForExecution,
  rejectSuggestion,
} from "@/lib/agents/service-core";

const ids = { userId: "user-1", suggestionId: "sugg-1" };

function seed(status: SuggestionStatus) {
  store.row = {
    id: ids.suggestionId,
    userId: ids.userId,
    status,
    expiresAt: new Date(Date.now() + 60_000),
    actedAt: null,
  };
}

describe("suggestion approve/reject transitions", () => {
  beforeEach(() => {
    store.afterFirstRead = null;
  });

  it("a stale approve cannot move an EXECUTING suggestion back to APPROVED", async () => {
    // approve reads OPEN, then a concurrent request (approve + claim) moves
    // it to EXECUTING before this approve writes.
    seed(SuggestionStatus.OPEN);
    store.afterFirstRead = () => {
      store.row.status = SuggestionStatus.EXECUTING;
    };

    await expect(approveSuggestion(ids)).rejects.toMatchObject({
      detail: "Only open suggestions can be approved.",
    });
    expect(store.row.status).toBe(SuggestionStatus.EXECUTING);
    await expect(claimSuggestionForExecution(ids)).rejects.toThrow();
  });

  it("a stale approve does not overwrite a concurrent rejection", async () => {
    seed(SuggestionStatus.OPEN);
    store.afterFirstRead = () => {
      store.row.status = SuggestionStatus.REJECTED;
    };

    await expect(approveSuggestion(ids)).rejects.toMatchObject({
      detail: "Only open suggestions can be approved.",
    });
    expect(store.row.status).toBe(SuggestionStatus.REJECTED);
  });

  it("a stale reject does not overwrite EXECUTING", async () => {
    seed(SuggestionStatus.APPROVED);
    store.afterFirstRead = () => {
      store.row.status = SuggestionStatus.EXECUTING;
    };

    await expect(rejectSuggestion(ids)).rejects.toMatchObject({
      detail: "Only open or approved suggestions can be rejected.",
    });
    expect(store.row.status).toBe(SuggestionStatus.EXECUTING);
  });

  it("still approves and rejects open suggestions and returns the record", async () => {
    seed(SuggestionStatus.OPEN);
    await expect(approveSuggestion(ids)).resolves.toMatchObject({
      status: SuggestionStatus.APPROVED,
    });
    await expect(rejectSuggestion(ids)).resolves.toMatchObject({
      status: SuggestionStatus.REJECTED,
    });
  });

  it("marks an expired open suggestion EXPIRED and throws", async () => {
    seed(SuggestionStatus.OPEN);
    store.row.expiresAt = new Date(Date.now() - 1_000);
    await expect(approveSuggestion(ids)).rejects.toMatchObject({
      detail: "This suggestion has expired.",
    });
    expect(store.row.status).toBe(SuggestionStatus.EXPIRED);
  });
});
