import { describe, expect, it, vi } from "vitest";
import type Redis from "ioredis";
import { SharedConnectionAdmission } from "@/lib/collaboration/shared-admission";

const limits = { global: 3, perCanvas: 2, perPrincipal: 2, perClient: 10 };

function admission(redis: Redis | null) {
  const logger = { error: vi.fn() };
  return {
    logger,
    admission: new SharedConnectionAdmission({
      scope: "test",
      limits,
      upgradesPerMinute: 2,
      leaseMs: 1_000,
      redis,
      logger,
    }),
  };
}

let next = 0;
function connection(principalId: string, canvasId = "c1") {
  next += 1;
  return { id: `k${next}`, canvasId, principalId, clientId: "ip" };
}

describe("shared connection admission (IMP-043)", () => {
  it("applies process-local limits without Redis", async () => {
    const { admission: local } = admission(null);
    expect(await local.admit(connection("a"))).toEqual({ admitted: true });
    expect(await local.admit(connection("b"))).toEqual({ admitted: true });
    expect(await local.admit(connection("c"))).toEqual({
      admitted: false,
      reason: "canvas",
    });
    const held = connection("a", "c2");
    expect(await local.admit(held)).toEqual({ admitted: true });
    expect(await local.admit(connection("d", "c3"))).toEqual({
      admitted: false,
      reason: "global",
    });
    await local.release(held);
    expect(local.totalConnections).toBe(2);
    expect(await local.consumeUpgrade("ip")).toBe(true);
    expect(await local.consumeUpgrade("ip")).toBe(true);
    expect(await local.consumeUpgrade("ip")).toBe(false);
  });

  it("falls back to process-local limits when Redis fails", async () => {
    const failing = {
      eval: vi.fn().mockRejectedValue(new Error("down")),
    } as unknown as Redis;
    const { admission: shared, logger } = admission(failing);
    expect(await shared.admit(connection("a"))).toEqual({ admitted: true });
    expect(await shared.admit(connection("a", "c2"))).toEqual({
      admitted: true,
    });
    expect(await shared.admit(connection("a", "c3"))).toEqual({
      admitted: false,
      reason: "principal",
    });
    expect(await shared.consumeUpgrade("ip")).toBe(true);
    expect(logger.error).toHaveBeenCalled();
  });

  it("undoes the local count when Redis refuses", async () => {
    const refusing = {
      eval: vi.fn().mockResolvedValue(2),
    } as unknown as Redis;
    const { admission: shared } = admission(refusing);
    expect(await shared.admit(connection("a"))).toEqual({
      admitted: false,
      reason: "principal",
    });
    expect(shared.totalConnections).toBe(0);
  });
});
