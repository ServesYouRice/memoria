import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";
import { UnauthorizedError } from "@/lib/errors";

const authMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  apiKeyFindMany: vi.fn(),
  apiKeyFindUnique: vi.fn(),
  apiKeyCreate: vi.fn(),
  apiKeyUpdate: vi.fn(),
}));

const apiKeyMocks = vi.hoisted(() => ({
  generateApiKey: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireAuth: authMocks.requireAuth,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    apiKey: {
      findMany: prismaMocks.apiKeyFindMany,
      findUnique: prismaMocks.apiKeyFindUnique,
      create: prismaMocks.apiKeyCreate,
      update: prismaMocks.apiKeyUpdate,
    },
  },
}));

vi.mock("@/lib/api/api-key", () => ({
  generateApiKey: apiKeyMocks.generateApiKey,
}));

import {
  GET as apiKeysGet,
  POST as apiKeysPost,
} from "@/app/api/v1/api-keys/route";
import { DELETE as apiKeyDelete } from "@/app/api/v1/api-keys/[keyId]/route";

function createNextRequest(
  url: string,
  options?: {
    method?: string;
    body?: unknown;
  },
): NextRequest {
  const init: RequestInit = {
    method: options?.method || "GET",
    headers: { "Content-Type": "application/json" },
  };
  if (options?.body !== undefined) {
    init.body =
      typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body);
  }
  const req = new Request(url, init);
  (req as any).nextUrl = new URL(url);
  return req as unknown as NextRequest;
}

describe("API Key Management Routes (IMP-063)", () => {
  const userId = "user-123";
  const outsiderId = "user-outsider-456";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("GET /api/v1/api-keys (List API Keys)", () => {
    it("scopes query strictly to authenticated userId and omits hash and plaintext", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId });

      const mockDbKeys = [
        {
          id: "key-1",
          name: "My Development Key",
          key: "$argon2id$v=19$m=19456,t=2,p=1$secretHashValueMustNeverLeak",
          keyPrefix: "mk_1234",
          keySuffix: "5678",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          lastUsedAt: new Date("2026-01-02T00:00:00.000Z"),
          expiresAt: new Date("2027-01-01T00:00:00.000Z"),
          revokedAt: null,
        },
      ];

      prismaMocks.apiKeyFindMany.mockResolvedValue(mockDbKeys);

      const res = await apiKeysGet(
        createNextRequest("http://localhost/api/v1/api-keys"),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.keys).toHaveLength(1);

      const keyEntry = json.keys[0];
      expect(keyEntry.id).toBe("key-1");
      expect(keyEntry.name).toBe("My Development Key");
      expect(keyEntry.keyPreview).toBe("mk_1234...5678");
      expect(keyEntry.keyPrefix).toBe("mk_1234");
      expect(keyEntry.keySuffix).toBe("5678");
      expect(keyEntry.createdAt).toBe("2026-01-01T00:00:00.000Z");

      // Critical security assertion: hash and plaintext are never leaked in list response
      expect((keyEntry as any).key).toBeUndefined();
      expect((keyEntry as any).plaintextKey).toBeUndefined();
      expect(JSON.stringify(json)).not.toContain(
        "secretHashValueMustNeverLeak",
      );

      expect(prismaMocks.apiKeyFindMany).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("POST /api/v1/api-keys (Create API Key)", () => {
    it("rejects unauthenticated requests without generating a key or querying database", async () => {
      authMocks.requireAuth.mockRejectedValue(new UnauthorizedError());

      const req = createNextRequest("http://localhost/api/v1/api-keys", {
        method: "POST",
        body: { name: "Test Key" },
      });
      const res = await apiKeysPost(req);

      expect(res.status).toBe(401);
      expect(apiKeyMocks.generateApiKey).not.toHaveBeenCalled();
      expect(prismaMocks.apiKeyCreate).not.toHaveBeenCalled();
    });

    it("rejects empty name before generating key or creating record", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId });

      const req = createNextRequest("http://localhost/api/v1/api-keys", {
        method: "POST",
        body: { name: "" },
      });
      const res = await apiKeysPost(req);

      expect(res.status).toBe(400);
      expect(apiKeyMocks.generateApiKey).not.toHaveBeenCalled();
      expect(prismaMocks.apiKeyCreate).not.toHaveBeenCalled();
    });

    it("rejects oversized name before generating key or creating record", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId });

      const req = createNextRequest("http://localhost/api/v1/api-keys", {
        method: "POST",
        body: { name: "a".repeat(256) },
      });
      const res = await apiKeysPost(req);

      expect(res.status).toBe(400);
      expect(apiKeyMocks.generateApiKey).not.toHaveBeenCalled();
      expect(prismaMocks.apiKeyCreate).not.toHaveBeenCalled();
    });

    it("rejects malformed date string before generating key or creating record", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId });

      const req = createNextRequest("http://localhost/api/v1/api-keys", {
        method: "POST",
        body: { name: "Key With Bad Date", expiresAt: "invalid-iso-date" },
      });
      const res = await apiKeysPost(req);

      expect(res.status).toBe(400);
      expect(apiKeyMocks.generateApiKey).not.toHaveBeenCalled();
      expect(prismaMocks.apiKeyCreate).not.toHaveBeenCalled();
    });

    it("rejects past expiry date before generating key or creating record", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId });
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-25T12:00:00.000Z"));

      const pastDate = new Date("2026-08-25T11:59:59.000Z").toISOString();

      const req = createNextRequest("http://localhost/api/v1/api-keys", {
        method: "POST",
        body: { name: "Expired Key", expiresAt: pastDate },
      });
      const res = await apiKeysPost(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.detail).toMatch(/expiresAt must be in the future/i);
      expect(apiKeyMocks.generateApiKey).not.toHaveBeenCalled();
      expect(prismaMocks.apiKeyCreate).not.toHaveBeenCalled();
    });

    it("creates API key, stores Argon2 hash in database (never plaintext), and returns plaintext once without hash in response", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId });
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-25T12:00:00.000Z"));

      const futureDate = new Date("2027-08-25T12:00:00.000Z");
      const generatedPlaintext = "mk_abcdefghijklmnopqrstuvwxyz123456";
      const generatedHash =
        "$argon2id$v=19$m=19456,t=2,p=1$argon2HashedStringForDatabaseOnly";

      apiKeyMocks.generateApiKey.mockResolvedValue({
        key: generatedPlaintext,
        hash: generatedHash,
      });

      const mockCreatedRecord = {
        id: "key-created-1",
        name: "Production Agent Key",
        key: generatedHash,
        keyPrefix: "mk_abcd",
        keySuffix: "3456",
        userId,
        expiresAt: futureDate,
        createdAt: new Date("2026-08-25T12:00:00.000Z"),
        lastUsedAt: null,
        revokedAt: null,
      };

      prismaMocks.apiKeyCreate.mockResolvedValue(mockCreatedRecord);

      const req = createNextRequest("http://localhost/api/v1/api-keys", {
        method: "POST",
        body: {
          name: "Production Agent Key",
          expiresAt: futureDate.toISOString(),
        },
      });

      const res = await apiKeysPost(req);
      expect(res.status).toBe(201);
      const json = await res.json();

      // Plaintext returned once on creation
      expect(json.plaintextKey).toBe(generatedPlaintext);
      expect(json.apiKey.id).toBe("key-created-1");
      expect(json.apiKey.name).toBe("Production Agent Key");
      expect(json.apiKey.keyPreview).toBe("mk_abcd...3456");
      expect(json.apiKey.keyPrefix).toBe("mk_abcd");
      expect(json.apiKey.keySuffix).toBe("3456");

      // Critical security assertion: hash is never present in response
      expect((json.apiKey as any).key).toBeUndefined();
      expect(JSON.stringify(json)).not.toContain(generatedHash);

      // Verify database receives the hash, prefix, suffix, and owner ID
      expect(prismaMocks.apiKeyCreate).toHaveBeenCalledWith({
        data: {
          key: generatedHash,
          name: "Production Agent Key",
          userId,
          expiresAt: futureDate,
          keyPrefix: "mk_abcd",
          keySuffix: "3456",
        },
      });
    });
  });

  describe("DELETE /api/v1/api-keys/:keyId (Revoke API Key)", () => {
    it("returns 404 when key row does not exist", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId });
      prismaMocks.apiKeyFindUnique.mockResolvedValue(null);

      const req = createNextRequest(
        "http://localhost/api/v1/api-keys/key-nonexistent",
        {
          method: "DELETE",
        },
      );
      const res = await apiKeyDelete(req, {
        params: { keyId: "key-nonexistent" },
      });

      expect(res.status).toBe(404);
      expect(prismaMocks.apiKeyUpdate).not.toHaveBeenCalled();
    });

    it("denies non-owner with 403 and performs zero update", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId });
      prismaMocks.apiKeyFindUnique.mockResolvedValue({
        id: "key-outsider-1",
        userId: outsiderId,
        revokedAt: null,
      });

      const req = createNextRequest(
        "http://localhost/api/v1/api-keys/key-outsider-1",
        {
          method: "DELETE",
        },
      );
      const res = await apiKeyDelete(req, {
        params: { keyId: "key-outsider-1" },
      });

      expect(res.status).toBe(403);
      expect(prismaMocks.apiKeyUpdate).not.toHaveBeenCalled();
    });

    it("revokes active owned key by setting revokedAt", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId });
      prismaMocks.apiKeyFindUnique.mockResolvedValue({
        id: "key-owned-1",
        userId,
        revokedAt: null,
      });
      prismaMocks.apiKeyUpdate.mockResolvedValue({});

      const req = createNextRequest(
        "http://localhost/api/v1/api-keys/key-owned-1",
        {
          method: "DELETE",
        },
      );
      const res = await apiKeyDelete(req, { params: { keyId: "key-owned-1" } });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });

      expect(prismaMocks.apiKeyUpdate).toHaveBeenCalledWith({
        where: { id: "key-owned-1" },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it("returns success without calling update when key is already revoked (idempotent)", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId });
      prismaMocks.apiKeyFindUnique.mockResolvedValue({
        id: "key-owned-1",
        userId,
        revokedAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      const req = createNextRequest(
        "http://localhost/api/v1/api-keys/key-owned-1",
        {
          method: "DELETE",
        },
      );
      const res = await apiKeyDelete(req, { params: { keyId: "key-owned-1" } });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(prismaMocks.apiKeyUpdate).not.toHaveBeenCalled();
    });
  });
});
