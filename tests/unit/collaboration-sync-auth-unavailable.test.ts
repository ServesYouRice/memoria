import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  config: null as null | Record<string, (...args: never[]) => unknown>,
  authorize: vi.fn(),
}));

vi.mock("@hocuspocus/server", () => ({
  Server: class {
    hocuspocus = { getConnectionsCount: () => 0, documents: new Map() };
    constructor(config: Record<string, (...args: never[]) => unknown>) {
      captured.config = config;
    }
  },
}));
vi.mock("@/lib/collaboration/sync/authorization", () => ({
  authorizeSyncConnection: captured.authorize,
  canWriteDocument: () => true,
  refreshSyncAuthorizations: vi.fn(async () => new Map()),
}));

import { createSyncServer } from "@/lib/collaboration/sync/server";
import { SYNC_CLOSE_REASONS } from "@/lib/collaboration/sync/protocol";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function authenticate() {
  createSyncServer({
    prisma: {} as never,
    logger: logger as never,
    port: 0,
    allowedOrigin: "http://localhost:3000",
  });
  const onAuthenticate = captured.config!.onAuthenticate as unknown as (
    input: unknown,
  ) => Promise<unknown>;
  return onAuthenticate({
    documentName: "ccanvas000000000000000001",
    requestHeaders: new Headers(),
    token: "",
    connectionConfig: { readOnly: false },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("sync onAuthenticate backend failures", () => {
  it("reports a failed session or canvas lookup as unavailable", async () => {
    captured.authorize.mockRejectedValue(new Error("pool timeout"));
    await expect(authenticate()).rejects.toMatchObject({
      reason: SYNC_CLOSE_REASONS.unavailable,
    });
  });

  it("still reports no access as forbidden", async () => {
    captured.authorize.mockResolvedValue(null);
    await expect(authenticate()).rejects.toMatchObject({
      reason: SYNC_CLOSE_REASONS.forbidden,
    });
  });
});
