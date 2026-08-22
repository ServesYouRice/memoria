import { beforeEach, describe, expect, it, vi } from "vitest";
import * as argon2 from "argon2";
import type * as Argon2Module from "argon2";
import { authConfig } from "@/lib/auth";
import {
  isAccountLocked,
  recordFailedAttempt,
  resetInMemoryLockoutForTests,
} from "@/lib/auth/account-lockout";
import { prisma } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    canvas: {
      findUnique: vi.fn(),
    },
    canvasShare: {
      findMany: vi.fn(),
    },
    emailVerificationToken: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));

// An ESM module namespace is not configurable, so vi.spyOn(argon2, "verify")
// throws. Replacing the module with real implementations wrapped in vi.fn
// keeps the genuine hashing while making the calls observable — which is the
// point of the ordering assertions below.
vi.mock("argon2", async (importOriginal) => {
  const actual = await importOriginal<typeof Argon2Module>();
  return { ...actual, hash: vi.fn(actual.hash), verify: vi.fn(actual.verify) };
});

describe("auth ordering and capability handling (IMP-041)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetInMemoryLockoutForTests();
  });

  const credentialsProvider = authConfig.providers[0] as any;
  // CredentialsProvider keeps the application's authorize under `options` and
  // puts its own no-op stub on the provider itself. Reading the top-level one
  // returns that stub, which resolves null without touching the database, so
  // every assertion below would pass or fail for the wrong reason.
  const authorize =
    credentialsProvider.options?.authorize ?? credentialsProvider.authorize;

  describe("login authorization and lockout ordering", () => {
    it("rejects locked account immediately without invoking Argon2 verification", async () => {
      // Simulate account lockout for this client pair
      for (let i = 0; i < 5; i++) {
        await recordFailedAttempt("locked@example.com", "127.0.0.1");
      }
      expect(await isAccountLocked("locked@example.com", "127.0.0.1")).toBe(
        true,
      );

      const argonVerifySpy = vi.mocked(argon2.verify);

      const req = {
        headers: new Headers({ "x-memoria-client-ip": "127.0.0.1" }),
      };

      await expect(
        authorize(
          { email: "locked@example.com", password: "Password123!" },
          req,
        ),
      ).rejects.toThrowError();

      // Argon2 verify must NOT have been called for a locked attempt
      expect(argonVerifySpy).not.toHaveBeenCalled();
    });

    it("spends Argon2 work on unknown user and returns null", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      const argonVerifySpy = vi.mocked(argon2.verify);
      const req = {
        headers: new Headers({ "x-memoria-client-ip": "127.0.0.1" }),
      };

      const result = await authorize(
        { email: "unknown@example.com", password: "Password123!" },
        req,
      );

      expect(result).toBeNull();
      expect(argonVerifySpy).toHaveBeenCalled();
    });

    it("does not expose unverified email state when password is wrong", async () => {
      const mockUser = {
        id: "usr_123",
        email: "unverified@example.com",
        passwordHash: await argon2.hash("CorrectPassword123!"),
        emailVerified: null,
        name: "Test User",
        image: null,
        sessionVersion: 1,
      };
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);

      const req = {
        headers: new Headers({ "x-memoria-client-ip": "127.0.0.1" }),
      };

      // Attacker guessing wrong password for an unverified account
      const result = await authorize(
        { email: "unverified@example.com", password: "WrongPassword123!" },
        req,
      );

      // Must return null instead of throwing EmailNotVerifiedError
      expect(result).toBeNull();
    });

    it("throws EmailNotVerifiedError in production only when password is correct", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      try {
        const correctPassword = "CorrectPassword123!";
        const mockUser = {
          id: "usr_123",
          email: "unverified@example.com",
          passwordHash: await argon2.hash(correctPassword),
          emailVerified: null,
          name: "Test User",
          image: null,
          sessionVersion: 1,
        };
        vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);

        const req = {
          headers: new Headers({ "x-memoria-client-ip": "127.0.0.1" }),
        };

        // When correct password is provided, EmailNotVerifiedError is thrown
        await expect(
          authorize(
            { email: "unverified@example.com", password: correctPassword },
            req,
          ),
        ).rejects.toThrowError();
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it("clears failed attempts on successful login with valid credentials", async () => {
      const correctPassword = "CorrectPassword123!";
      const mockUser = {
        id: "usr_123",
        email: "verified@example.com",
        passwordHash: await argon2.hash(correctPassword),
        emailVerified: new Date(),
        name: "Verified User",
        image: null,
        sessionVersion: 1,
      };
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);

      // Record a few failed attempts first
      await recordFailedAttempt("verified@example.com", "127.0.0.1");
      await recordFailedAttempt("verified@example.com", "127.0.0.1");

      const req = {
        headers: new Headers({ "x-memoria-client-ip": "127.0.0.1" }),
      };

      const result = await authorize(
        { email: "verified@example.com", password: correctPassword },
        req,
      );

      expect(result).toEqual({
        id: "usr_123",
        email: "verified@example.com",
        name: "Verified User",
        image: null,
        sessionVersion: 1,
      });

      // Attempts should be cleared
      expect(await isAccountLocked("verified@example.com", "127.0.0.1")).toBe(
        false,
      );
    });
  });

  describe("canvas metadata role-aware redaction", () => {
    it("returns shareToken to owner and redacts shareToken for collaborator", async () => {
      const { GET } = await import("@/app/api/v1/canvases/[canvasId]/route.ts");
      const { requireAuth } = await import("@/lib/api/auth");

      vi.mock("@/lib/api/auth", () => ({
        requireAuth: vi.fn(),
        requireCanvasOwnership: vi.fn(),
        requireCanvasAccess: vi.fn(),
      }));

      const canvasMock = {
        id: "canvas_123",
        name: "Test Canvas",
        userId: "owner_usr",
        workspaceId: null,
        zoomLevel: 1,
        panX: 0,
        panY: 0,
        thumbnailKey: null,
        thumbnailRevision: 0,
        isPublic: false,
        isTemplate: false,
        templateDescription: null,
        templateCategory: null,
        shareToken: "secret_share_token_xyz",
        createdAt: new Date("2026-08-01T00:00:00Z"),
        updatedAt: new Date("2026-08-01T00:00:00Z"),
      };

      vi.mocked(prisma.canvas.findUnique).mockResolvedValue(canvasMock as any);

      // Case 1: Owner requests canvas metadata
      vi.mocked(requireAuth).mockResolvedValue({
        userId: "owner_usr",
        email: "owner@example.com",
      });
      vi.mocked(prisma.canvasShare.findMany).mockResolvedValue([]);

      const ownerReq = new Request(
        "http://localhost/api/v1/canvases/canvas_123",
      );
      const ownerRes = await GET(ownerReq, {
        params: Promise.resolve({ canvasId: "canvas_123" }),
      });
      const ownerBody = await ownerRes.json();

      expect(ownerRes.status).toBe(200);
      expect(ownerBody.shareToken).toBe("secret_share_token_xyz");
      expect(ownerBody.accessLevel).toBe("OWNER");

      // Case 2: Collaborator (non-owner) requests canvas metadata
      vi.mocked(requireAuth).mockResolvedValue({
        userId: "collab_usr",
        email: "collab@example.com",
      });
      vi.mocked(prisma.canvasShare.findMany).mockResolvedValue([
        {
          id: "share_1",
          role: "EDIT" as any,
          createdAt: new Date("2026-08-01T00:00:00Z"),
        },
      ]);

      const collabReq = new Request(
        "http://localhost/api/v1/canvases/canvas_123",
      );
      const collabRes = await GET(collabReq, {
        params: Promise.resolve({ canvasId: "canvas_123" }),
      });
      const collabBody = await collabRes.json();

      expect(collabRes.status).toBe(200);
      expect(collabBody.shareToken).toBeNull();
      expect(collabBody.accessLevel).toBe("EDIT");
    });
  });
});
