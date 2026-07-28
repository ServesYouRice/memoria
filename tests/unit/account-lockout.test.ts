import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));

import {
  getLoginDelay,
  clearFailedAttempts,
  isAccountLocked,
  recordFailedAttempt,
  resetInMemoryLockoutForTests,
} from "@/lib/auth/account-lockout";

describe("principal/client login escalation", () => {
  beforeEach(() => {
    resetInMemoryLockoutForTests();
    vi.useFakeTimers();
  });

  it("locks only the attacking client pair", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await recordFailedAttempt("victim@example.com", "client-a");
    }
    expect(await isAccountLocked("victim@example.com", "client-a")).toBe(true);
    expect(await isAccountLocked("victim@example.com", "client-b")).toBe(false);
  });

  it("adds a bounded account-wide delay instead of an account-wide lock", async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await recordFailedAttempt("victim@example.com", `client-${attempt}`);
    }
    expect(await getLoginDelay("victim@example.com")).toBe(2_000);
    expect(await isAccountLocked("victim@example.com", "new-client")).toBe(
      false,
    );
  });

  it("expires pair escalation", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await recordFailedAttempt("victim@example.com", "client-a");
    }
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect(await isAccountLocked("victim@example.com", "client-a")).toBe(false);
  });

  it("clears escalation after a verified credential", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await recordFailedAttempt("victim@example.com", "client-a");
    }
    await clearFailedAttempts("victim@example.com", "client-a");
    expect(await isAccountLocked("victim@example.com", "client-a")).toBe(false);
    expect(await getLoginDelay("victim@example.com")).toBe(0);
  });
});
