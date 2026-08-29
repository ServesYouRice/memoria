import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_CONTROL_MESSAGES_PER_MINUTE,
  MAX_CURSOR_MESSAGES_PER_MINUTE,
  ConnectionAdmissionCounters,
  ExpiringCanvasInstances,
  FixedWindowAdmissionBudget,
  authorizationLeaseMustClose,
  collaborationCloseDisposition,
  collaborationColorForUser,
  consumeMessageBudget,
  cursorIdentityVariant,
  reconnectDelayMs,
  resolveCollaborationAccess,
  type MessageBudgetState,
} from "@/lib/collaboration/transport-policy";

afterEach(() => {
  vi.useRealTimers();
});

describe("collaboration transport budgets", () => {
  it("drops excess cursor frames without spending chat/reaction capacity", () => {
    const budget: MessageBudgetState = {
      cursorCount: 0,
      controlCount: 0,
      resetAt: 60_000,
    };

    for (let index = 0; index < MAX_CURSOR_MESSAGES_PER_MINUTE; index += 1) {
      expect(consumeMessageBudget(budget, "cursor", 1_000)).toBe("allow");
    }
    expect(consumeMessageBudget(budget, "cursor", 1_000)).toBe("drop");
    expect(consumeMessageBudget(budget, "message", 1_000)).toBe("allow");
    expect(budget.controlCount).toBe(1);

    for (let index = 1; index < MAX_CONTROL_MESSAGES_PER_MINUTE; index += 1) {
      expect(consumeMessageBudget(budget, "awareness", 1_000)).toBe("allow");
    }
    expect(consumeMessageBudget(budget, "message", 1_000)).toBe("terminate");
  });

  it("sweeps expired failed-upgrade windows", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const upgrades = new FixedWindowAdmissionBudget(2, 60_000);
    expect(upgrades.consume("client-a")).toBe(true);
    expect(upgrades.consume("client-a")).toBe(true);
    expect(upgrades.consume("client-a")).toBe(false);
    expect(upgrades.size).toBe(1);

    vi.setSystemTime(60_000);
    upgrades.sweep();
    expect(upgrades.size).toBe(0);
    expect(upgrades.consume("client-a")).toBe(true);
  });
});

describe("collaboration peer leases and authorization", () => {
  it("expires only the lost peer in a two-instance presence projection", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const presence = new ExpiringCanvasInstances<string[]>();
    presence.upsert("canvas-1", "instance-a", ["alice"], Date.now());
    presence.upsert("canvas-1", "instance-b", ["bob"], Date.now());

    vi.setSystemTime(40_000);
    presence.upsert("canvas-1", "instance-b", ["bob"], Date.now());

    vi.setSystemTime(76_000);
    expect(presence.sweep()).toEqual(["canvas-1"]);
    expect(presence.values("canvas-1")).toEqual([["bob"]]);
    expect(presence.instanceCount).toBe(1);

    vi.setSystemTime(116_000);
    expect(presence.sweep()).toEqual(["canvas-1"]);
    expect(presence.values("canvas-1")).toEqual([]);
  });

  it("fails closed for rotated guest links and revoked sessions", () => {
    const canvas = {
      userId: "owner",
      isPublic: true,
      shareToken: "current-token",
    };
    expect(
      resolveCollaborationAccess({
        principalId: "guest:one",
        guestShareToken: "old-token",
        canvas,
      }),
    ).toBeNull();
    expect(
      resolveCollaborationAccess({
        principalId: "guest:one",
        guestShareToken: "current-token",
        canvas,
      }),
    ).toBe("VIEW");
    expect(
      resolveCollaborationAccess({
        principalId: "member",
        expectedSessionVersion: 3,
        persistedSessionVersion: 4,
        canvas,
        sharedRole: "EDIT",
      }),
    ).toBeNull();
  });

  it("allows two refresh failures but closes on the third or lease expiry", () => {
    expect(
      authorizationLeaseMustClose({
        consecutiveFailures: 2,
        leaseExpiresAt: 90_000,
        now: 60_000,
      }),
    ).toBe(false);
    expect(
      authorizationLeaseMustClose({
        consecutiveFailures: 3,
        leaseExpiresAt: 120_000,
        now: 60_000,
      }),
    ).toBe(true);
    expect(
      authorizationLeaseMustClose({
        consecutiveFailures: 1,
        leaseExpiresAt: 60_000,
        now: 60_000,
      }),
    ).toBe(true);
  });
});

describe("collaboration capacity and reconnect policy", () => {
  it("profiles the supported process capacity with constant-time counters", () => {
    const counters = new ConnectionAdmissionCounters();
    const limits = { global: 5_000, perPrincipal: 10, perClient: 30 };

    for (let index = 0; index < limits.global; index += 1) {
      expect(
        counters.tryAdmit(`principal-${index}`, `client-${index}`, limits),
      ).toEqual({ admitted: true });
    }
    expect(counters.totalConnections).toBe(5_000);
    expect(counters.tryAdmit("overflow", "overflow", limits)).toEqual({
      admitted: false,
      reason: "global",
    });

    counters.release("principal-0", "client-0");
    expect(counters.totalConnections).toBe(4_999);
    expect(counters.countForPrincipal("principal-0")).toBe(0);
    expect(counters.tryAdmit("overflow", "overflow", limits)).toEqual({
      admitted: true,
    });
  });

  it("stops policy closes and failed upgrades but retries transient closes", () => {
    expect(
      collaborationCloseDisposition({
        code: 1008,
        opened: true,
        intentional: false,
      }),
    ).toBe("stop");
    expect(
      collaborationCloseDisposition({
        code: 1006,
        opened: false,
        intentional: false,
      }),
    ).toBe("stop");
    expect(
      collaborationCloseDisposition({
        code: 1011,
        opened: true,
        intentional: false,
      }),
    ).toBe("retry");
    expect(reconnectDelayMs(1, 0)).toBe(1_000);
    expect(reconnectDelayMs(20, 1)).toBe(19_500);
  });

  it("keeps cursor identity stable across reconnects and color collisions", () => {
    expect(collaborationColorForUser("alice")).toBe(
      collaborationColorForUser("alice"),
    );
    expect(cursorIdentityVariant("alice")).toBe(cursorIdentityVariant("alice"));

    const seen = new Map<string, { id: string; variant: number }>();
    let collision:
      | {
          first: { id: string; variant: number };
          second: { id: string; variant: number };
        }
      | undefined;
    for (let index = 0; index < 2_000 && !collision; index += 1) {
      const id = `user-${index}`;
      const color = collaborationColorForUser(id);
      const variant = cursorIdentityVariant(id);
      const first = seen.get(color);
      if (first && first.variant !== variant) {
        collision = { first, second: { id, variant } };
      } else if (!first) {
        seen.set(color, { id, variant });
      }
    }
    expect(collision).toBeDefined();
    expect(collision?.first.variant).not.toBe(collision?.second.variant);
  });
});
