import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";
import {
  AgentProfileStatus,
  IntegrationStatus,
} from "@/generated/prisma/client";

const prismaMocks = vi.hoisted(() => ({
  agentProfileFindFirst: vi.fn(),
  integrationAccountFindFirst: vi.fn(),
  integrationAccountUpdateMany: vi.fn(),
}));

const sessionCacheMocks = vi.hoisted(() => ({
  getCachedSession: vi.fn(),
}));

const argon2Mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  hash: vi.fn(),
  argon2id: 2,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    agentProfile: {
      findFirst: prismaMocks.agentProfileFindFirst,
    },
    integrationAccount: {
      findFirst: prismaMocks.integrationAccountFindFirst,
      updateMany: prismaMocks.integrationAccountUpdateMany,
    },
  },
}));

vi.mock("@/lib/api/session-cache", () => ({
  getCachedSession: sessionCacheMocks.getCachedSession,
}));

vi.mock("argon2", () => ({
  verify: argon2Mocks.verify,
  hash: argon2Mocks.hash,
  argon2id: argon2Mocks.argon2id,
}));

import {
  generateIntegrationToken,
  getOwnedAgentProfile,
  resolveAgentRequestContext,
} from "@/lib/agents/auth";

function createNextRequest(
  url = "http://localhost/api/agent/v1/actions",
  options?: {
    headers?: Record<string, string>;
  },
): NextRequest {
  const headers = new Headers(options?.headers || {});
  const req = new Request(url, { headers });
  (req as any).nextUrl = new URL(url);
  return req as unknown as NextRequest;
}

describe("resolveAgentRequestContext (IMP-059)", () => {
  const userId = "user-123";
  const mockAgentProfile = {
    id: "prof-1",
    userId,
    name: "Research Bot",
    status: AgentProfileStatus.ACTIVE,
    maxCapabilityRung: 3,
    enabledRungs: [1, 2, 3],
    allowedCanvasIds: ["canvas-1"],
    defaultModelCredentialId: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    argon2Mocks.verify.mockResolvedValue(false);
    sessionCacheMocks.getCachedSession.mockResolvedValue(null);
  });

  describe("Integration token authentication", () => {
    const validToken = "mat_1234567890abcdefghijklmnopqrstuvwxyz123456";
    // prefix: "mat_1234" (8 chars)
    // suffix: "123456" (6 chars)

    it("extracts token from Authorization: Bearer header", async () => {
      prismaMocks.integrationAccountFindFirst.mockResolvedValue({
        id: "int-1",
        encryptedSecretOrHash: "$argon2id$tokenHash",
        agentProfile: mockAgentProfile,
        lastSeenAt: new Date(),
      });
      argon2Mocks.verify.mockResolvedValue(true);

      const req = createNextRequest("http://localhost/api/agent/v1/actions", {
        headers: { authorization: `Bearer ${validToken}` },
      });

      const context = await resolveAgentRequestContext(req);

      expect(context).toEqual({
        actorType: "integration",
        userId,
        agentProfile: mockAgentProfile,
        integrationAccountId: "int-1",
      });

      expect(prismaMocks.integrationAccountFindFirst).toHaveBeenCalledWith({
        where: {
          secretPrefix: "mat_1234",
          secretSuffix: "123456",
          status: IntegrationStatus.ACTIVE,
          agentProfile: {
            status: AgentProfileStatus.ACTIVE,
          },
        },
        include: {
          agentProfile: {
            select: {
              id: true,
              userId: true,
              name: true,
              status: true,
              maxCapabilityRung: true,
              enabledRungs: true,
              allowedCanvasIds: true,
              defaultModelCredentialId: true,
            },
          },
        },
      });
      expect(argon2Mocks.verify).toHaveBeenCalledWith(
        "$argon2id$tokenHash",
        validToken,
      );
    });

    it("extracts token from x-agent-token header", async () => {
      prismaMocks.integrationAccountFindFirst.mockResolvedValue({
        id: "int-1",
        encryptedSecretOrHash: "$argon2id$tokenHash",
        agentProfile: mockAgentProfile,
        lastSeenAt: new Date(),
      });
      argon2Mocks.verify.mockResolvedValue(true);

      const req = createNextRequest("http://localhost/api/agent/v1/actions", {
        headers: { "x-agent-token": validToken },
      });

      const context = await resolveAgentRequestContext(req);
      expect(context.actorType).toBe("integration");
      expect(context.integrationAccountId).toBe("int-1");
    });

    it("throws UnauthorizedError when integration account is not found without falling back to session", async () => {
      // Even if session exists, invalid token must NOT fall back to session
      sessionCacheMocks.getCachedSession.mockResolvedValue({
        user: { id: "user-session-fallback" },
      });
      prismaMocks.integrationAccountFindFirst.mockResolvedValue(null);

      const req = createNextRequest("http://localhost/api/agent/v1/actions", {
        headers: { authorization: `Bearer ${validToken}` },
      });

      await expect(resolveAgentRequestContext(req)).rejects.toMatchObject({
        status: 401,
        detail: "Invalid integration token.",
      });

      expect(sessionCacheMocks.getCachedSession).not.toHaveBeenCalled();
    });

    it("throws UnauthorizedError when Argon2 verification fails", async () => {
      prismaMocks.integrationAccountFindFirst.mockResolvedValue({
        id: "int-1",
        encryptedSecretOrHash: "$argon2id$tokenHash",
        agentProfile: mockAgentProfile,
        lastSeenAt: new Date(),
      });
      argon2Mocks.verify.mockResolvedValue(false);

      const req = createNextRequest("http://localhost/api/agent/v1/actions", {
        headers: { authorization: `Bearer ${validToken}` },
      });

      await expect(resolveAgentRequestContext(req)).rejects.toMatchObject({
        status: 401,
        detail: "Invalid integration token.",
      });
    });

    it("updates lastSeenAt when lastSeenAt is null or older than 5 minutes", async () => {
      const staleLastSeen = new Date(Date.now() - 10 * 60 * 1000);
      prismaMocks.integrationAccountFindFirst.mockResolvedValue({
        id: "int-1",
        encryptedSecretOrHash: "$argon2id$tokenHash",
        agentProfile: mockAgentProfile,
        lastSeenAt: staleLastSeen,
      });
      argon2Mocks.verify.mockResolvedValue(true);

      const req = createNextRequest("http://localhost/api/agent/v1/actions", {
        headers: { authorization: `Bearer ${validToken}` },
      });

      await resolveAgentRequestContext(req);

      expect(prismaMocks.integrationAccountUpdateMany).toHaveBeenCalledWith({
        where: {
          id: "int-1",
          OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: expect.any(Date) } }],
        },
        data: { lastSeenAt: expect.any(Date) },
      });
    });

    it("does not treat x-api-key as an agent credential when session and token are absent", async () => {
      const req = createNextRequest("http://localhost/api/agent/v1/actions", {
        headers: { "x-api-key": "mk_valid_api_key_format_1234567890" },
      });

      await expect(resolveAgentRequestContext(req)).rejects.toMatchObject({
        status: 401,
      });
    });
  });

  describe("User session authentication", () => {
    it("throws UnauthorizedError when session is missing", async () => {
      sessionCacheMocks.getCachedSession.mockResolvedValue(null);

      const req = createNextRequest("http://localhost/api/agent/v1/actions");

      await expect(resolveAgentRequestContext(req)).rejects.toMatchObject({
        status: 401,
      });
    });

    it("resolves user session without requested profile as agentProfile: null", async () => {
      sessionCacheMocks.getCachedSession.mockResolvedValue({
        user: { id: userId },
      });

      const req = createNextRequest("http://localhost/api/agent/v1/actions");

      const context = await resolveAgentRequestContext(req);

      expect(context).toEqual({
        actorType: "user",
        userId,
        agentProfile: null,
        integrationAccountId: null,
      });
      expect(prismaMocks.agentProfileFindFirst).not.toHaveBeenCalled();
    });

    it("resolves requested agent profile via header and scopes by owner userId", async () => {
      sessionCacheMocks.getCachedSession.mockResolvedValue({
        user: { id: userId },
      });
      prismaMocks.agentProfileFindFirst.mockResolvedValue(mockAgentProfile);

      const req = createNextRequest("http://localhost/api/agent/v1/actions", {
        headers: { "x-agent-profile-id": "prof-1" },
      });

      const context = await resolveAgentRequestContext(req);

      expect(context).toEqual({
        actorType: "user",
        userId,
        agentProfile: mockAgentProfile,
        integrationAccountId: null,
      });

      expect(prismaMocks.agentProfileFindFirst).toHaveBeenCalledWith({
        where: { id: "prof-1", userId },
        select: {
          id: true,
          userId: true,
          name: true,
          status: true,
          maxCapabilityRung: true,
          enabledRungs: true,
          allowedCanvasIds: true,
          defaultModelCredentialId: true,
        },
      });
    });

    it("resolves requested agent profile via query param agentProfileId", async () => {
      sessionCacheMocks.getCachedSession.mockResolvedValue({
        user: { id: userId },
      });
      prismaMocks.agentProfileFindFirst.mockResolvedValue(mockAgentProfile);

      const req = createNextRequest(
        "http://localhost/api/agent/v1/actions?agentProfileId=prof-1",
      );

      const context = await resolveAgentRequestContext(req);
      expect(context.agentProfile).toEqual(mockAgentProfile);
    });

    it("throws ForbiddenError when requested agent profile is not owned by user", async () => {
      sessionCacheMocks.getCachedSession.mockResolvedValue({
        user: { id: userId },
      });
      prismaMocks.agentProfileFindFirst.mockResolvedValue(null);

      const req = createNextRequest("http://localhost/api/agent/v1/actions", {
        headers: { "x-agent-profile-id": "prof-other-user" },
      });

      await expect(resolveAgentRequestContext(req)).rejects.toMatchObject({
        status: 403,
        detail: "Agent profile not found for this user.",
      });
    });

    it("throws BadRequestError when requireAgentProfile is true but no profile is provided", async () => {
      sessionCacheMocks.getCachedSession.mockResolvedValue({
        user: { id: userId },
      });

      const req = createNextRequest("http://localhost/api/agent/v1/actions");

      await expect(
        resolveAgentRequestContext(req, { requireAgentProfile: true }),
      ).rejects.toMatchObject({
        status: 400,
        detail: "agentProfileId is required for this endpoint.",
      });
    });

    it("throws UnauthorizedError when allowUserSession is false even if valid session is active", async () => {
      sessionCacheMocks.getCachedSession.mockResolvedValue({
        user: { id: userId },
      });

      const req = createNextRequest(
        "http://localhost/api/agent/v1/integrations/ingest",
      );

      await expect(
        resolveAgentRequestContext(req, { allowUserSession: false }),
      ).rejects.toMatchObject({
        status: 401,
        detail: "An integration token is required for this endpoint.",
      });

      expect(sessionCacheMocks.getCachedSession).not.toHaveBeenCalled();
    });
  });

  describe("getOwnedAgentProfile helper", () => {
    it("returns profile when found for user", async () => {
      prismaMocks.agentProfileFindFirst.mockResolvedValue(mockAgentProfile);

      const profile = await getOwnedAgentProfile(userId, "prof-1");
      expect(profile).toEqual(mockAgentProfile);
      expect(prismaMocks.agentProfileFindFirst).toHaveBeenCalledWith({
        where: { id: "prof-1", userId },
        select: expect.any(Object),
      });
    });

    it("throws ForbiddenError when profile is not found", async () => {
      prismaMocks.agentProfileFindFirst.mockResolvedValue(null);

      await expect(
        getOwnedAgentProfile(userId, "prof-nonexistent"),
      ).rejects.toMatchObject({
        status: 403,
        detail: "Agent profile not found for this user.",
      });
    });
  });

  describe("generateIntegrationToken helper", () => {
    it("generates a token with mat_ prefix and computes prefix/suffix/hash", async () => {
      argon2Mocks.hash.mockResolvedValue("$argon2id$computedHash");

      const result = await generateIntegrationToken();

      expect(result.plaintextToken.startsWith("mat_")).toBe(true);
      expect(result.prefix).toBe(result.plaintextToken.slice(0, 8));
      expect(result.suffix).toBe(result.plaintextToken.slice(-6));
      expect(result.hash).toBe("$argon2id$computedHash");
      expect(argon2Mocks.hash).toHaveBeenCalledWith(
        result.plaintextToken,
        expect.any(Object),
      );
    });
  });
});
