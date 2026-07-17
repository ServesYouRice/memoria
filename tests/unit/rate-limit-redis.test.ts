import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedisRateLimitStore } from "@/lib/rate-limit/stores/redis";

const evalMock = vi.fn();
const onMock = vi.fn();

vi.mock("ioredis", () => ({
  default: class RedisMock {
    on = onMock;
    eval = evalMock;
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe("RedisRateLimitStore", () => {
  let store: RedisRateLimitStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new RedisRateLimitStore({
      host: "localhost",
      port: 6379,
      keyPrefix: "rate-limit:",
    });
  });

  it("should increment requests", async () => {
    evalMock.mockResolvedValueOnce([1, 60]);

    const result = await store.increment("test-ip", 60);

    expect(result.count).toBe(1);
    expect(result.ttl).toBe(60);
    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("INCR", KEYS[1])'),
      1,
      "rate-limit:test-ip",
      60,
    );
  });

  it("should not expire if count > 1", async () => {
    evalMock.mockResolvedValueOnce([5, 30]);

    const result = await store.increment("test-ip", 60);

    expect(result.count).toBe(5);
    expect(result.ttl).toBe(30);
  });

  it("should surface redis failures", async () => {
    evalMock.mockRejectedValueOnce(new Error("Redis down"));

    await expect(store.increment("test-ip", 60)).rejects.toThrow("Redis down");
  });
});
