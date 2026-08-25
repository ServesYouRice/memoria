import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";

const prismaMocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
}));

const apiKeyMocks = vi.hoisted(() => ({
  verifyApiKey: vi.fn(),
  isValidApiKeyFormat: vi.fn(),
}));

const rateLimiterMock = vi.hoisted(() => ({
  check: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    apiKey: {
      findMany: prismaMocks.findMany,
      update: prismaMocks.update,
    },
  },
}));

vi.mock("@/lib/api/api-key", () => ({
  verifyApiKey: apiKeyMocks.verifyApiKey,
  isValidApiKeyFormat: apiKeyMocks.isValidApiKeyFormat,
}));

vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: () => rateLimiterMock,
}));

import {
  authenticateApiKey,
  checkApiKeyRateLimit,
  getApiKeyRateLimitHeaders,
} from "@/lib/api/api-key-auth";

function createMockRequest(apiKeyHeader?: string | null): NextRequest {
  const headers = new Headers();
  if (apiKeyHeader !== undefined && apiKeyHeader !== null) {
    headers.set("x-api-key", apiKeyHeader);
  }
  return {
    headers,
  } as unknown as NextRequest;
}

describe("authenticateApiKey (IMP-056)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiKeyMocks.isValidApiKeyFormat.mockImplementation(
      (key: string) => key.startsWith("mk_") && key.length >= 23,
    );
  });

  describe("cheap rejection path", () => {
    it("returns null when x-api-key header is missing without querying DB", async () => {
      const req = createMockRequest();
      const result = await authenticateApiKey(req);

      expect(result).toBeNull();
      expect(prismaMocks.findMany).not.toHaveBeenCalled();
      expect(apiKeyMocks.verifyApiKey).not.toHaveBeenCalled();
    });

    it("returns null for malformed and short keys without database query", async () => {
      apiKeyMocks.isValidApiKeyFormat.mockReturnValue(false);

      const reqShort = createMockRequest("short");
      const resultShort = await authenticateApiKey(reqShort);
      expect(resultShort).toBeNull();

      const reqMalformed = createMockRequest("invalid-not-starting-with-mk");
      const resultMalformed = await authenticateApiKey(reqMalformed);
      expect(resultMalformed).toBeNull();

      // Key < 8 characters (cannot extract prefix/suffix)
      const resultTiny = await authenticateApiKey(createMockRequest("mk_1234"));
      expect(resultTiny).toBeNull();

      expect(prismaMocks.findMany).not.toHaveBeenCalled();
      expect(apiKeyMocks.verifyApiKey).not.toHaveBeenCalled();
    });
  });

  describe("candidate query contract and scope", () => {
    it("queries database with active, non-expired, and scoped prefix/suffix predicates", async () => {
      const key = "mk_1234567890abcdefghijklmnopqrstuv";
      // prefix = key.slice(0, 7) = "mk_1234"
      // suffix = key.slice(-4) = "stuv"
      const req = createMockRequest(key);

      prismaMocks.findMany.mockResolvedValue([]);

      const result = await authenticateApiKey(req);

      expect(result).toBeNull();
      expect(prismaMocks.findMany).toHaveBeenCalledTimes(1);
      expect(prismaMocks.findMany).toHaveBeenCalledWith({
        where: {
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
          keyPrefix: "mk_1234",
          keySuffix: "stuv",
        },
        include: { user: true },
      });
      // When no candidates match, verifyApiKey is never called
      expect(apiKeyMocks.verifyApiKey).not.toHaveBeenCalled();
    });
  });

  describe("candidate verification and error tolerance", () => {
    const validKey = "mk_1234567890abcdefghijklmnopqrstuv";
    const mockUser = {
      id: "user-123",
      name: "Test User",
      email: "test@example.com",
      image: null,
    };

    it("skips legacy plaintext keys without comparing or upgrading silently", async () => {
      const req = createMockRequest(validKey);

      prismaMocks.findMany.mockResolvedValue([
        {
          id: "key-legacy",
          name: "Legacy Plaintext Key",
          key: "mk_plaintext_legacy_value",
          user: mockUser,
        },
      ]);

      const result = await authenticateApiKey(req);

      expect(result).toBeNull();
      expect(apiKeyMocks.verifyApiKey).not.toHaveBeenCalled();
      expect(prismaMocks.update).not.toHaveBeenCalled();
    });

    it("returns null when Argon2 verification fails for candidate", async () => {
      const req = createMockRequest(validKey);

      prismaMocks.findMany.mockResolvedValue([
        {
          id: "key-1",
          name: "Default Key",
          key: "$argon2id$v=19$m=19456,t=2,p=1$hash1",
          user: mockUser,
        },
      ]);
      apiKeyMocks.verifyApiKey.mockResolvedValue(false);

      const result = await authenticateApiKey(req);

      expect(result).toBeNull();
      expect(apiKeyMocks.verifyApiKey).toHaveBeenCalledWith(
        validKey,
        "$argon2id$v=19$m=19456,t=2,p=1$hash1",
      );
      expect(prismaMocks.update).not.toHaveBeenCalled();
    });

    it("authenticates successfully on matching Argon2 hash and updates lastUsedAt", async () => {
      const req = createMockRequest(validKey);

      prismaMocks.findMany.mockResolvedValue([
        {
          id: "key-1",
          name: "My API Key",
          key: "$argon2id$v=19$m=19456,t=2,p=1$hash1",
          user: mockUser,
        },
      ]);
      apiKeyMocks.verifyApiKey.mockResolvedValue(true);
      prismaMocks.update.mockResolvedValue({});

      const result = await authenticateApiKey(req);

      expect(result).toEqual({
        user: mockUser,
        apiKeyId: "key-1",
        apiKeyName: "My API Key",
      });
      expect(prismaMocks.update).toHaveBeenCalledWith({
        where: { id: "key-1" },
        data: { lastUsedAt: expect.any(Date) },
      });
    });

    it("does not fail authentication if lastUsedAt update rejects", async () => {
      const req = createMockRequest(validKey);

      prismaMocks.findMany.mockResolvedValue([
        {
          id: "key-1",
          name: "My API Key",
          key: "$argon2id$v=19$m=19456,t=2,p=1$hash1",
          user: mockUser,
        },
      ]);
      apiKeyMocks.verifyApiKey.mockResolvedValue(true);
      // Simulate fire-and-forget update failure
      prismaMocks.update.mockRejectedValue(new Error("DB connection dropped"));

      const result = await authenticateApiKey(req);

      expect(result).toEqual({
        user: mockUser,
        apiKeyId: "key-1",
        apiKeyName: "My API Key",
      });
    });
  });

  describe("rate limiting helpers", () => {
    it("calls apiKeyLimiter.check with apiKeyId", async () => {
      rateLimiterMock.check.mockResolvedValue({
        success: true,
        limit: 300,
        remaining: 299,
        resetAt: 1700000060,
        resetIn: 60,
      });

      const result = await checkApiKeyRateLimit("key-1");
      expect(result.success).toBe(true);
      expect(rateLimiterMock.check).toHaveBeenCalledWith("key-1");
    });

    it("formats rate limit headers correctly", () => {
      const headers = getApiKeyRateLimitHeaders({
        success: true,
        limit: 300,
        remaining: 250,
        resetAt: 1700000060,
        resetIn: 45,
      });

      expect(headers).toEqual({
        "X-RateLimit-Limit": "300",
        "X-RateLimit-Remaining": "250",
        "X-RateLimit-Reset": "1700000060",
        "X-RateLimit-Window": "45",
      });
    });
  });
});
