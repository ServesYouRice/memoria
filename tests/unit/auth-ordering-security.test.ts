import { beforeEach, describe, expect, it, vi } from "vitest";
import * as argon2 from "argon2";
import type * as Argon2Module from "argon2";
import {
  isAccountLocked,
  recordFailedAttempt,
  resetInMemoryLockoutForTests,
} from "@/lib/auth/account-lockout";
import { prisma } from "@/lib/db";
import { callAuth, CookieJar } from "../helpers/auth-harness";
import {
  addCredentialUser,
  buildMemoryAuth,
  signInWithPassword,
  TEST_CLIENT_IP,
} from "../helpers/memory-auth";

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

vi.mock("@/lib/api/auth", () => ({
  requireAuth: vi.fn(),
  requireCanvasOwnership: vi.fn(),
  requireCanvasAccess: vi.fn(),
}));

// An ESM module namespace is not configurable, so vi.spyOn(argon2, "verify")
// throws. Replacing the module with real implementations wrapped in vi.fn
// keeps the genuine hashing while making the calls observable — which is the
// point of the ordering assertions below.
vi.mock("argon2", async (importOriginal) => {
  const actual = await importOriginal<typeof Argon2Module>();
  return { ...actual, hash: vi.fn(actual.hash), verify: vi.fn(actual.verify) };
});

import { GET as canvasGet } from "@/app/api/v1/canvases/[canvasId]/route";
import { requireAuth } from "@/lib/api/auth";

const CLIENT_IP = TEST_CLIENT_IP;
const buildAuth = buildMemoryAuth;
const addUser = addCredentialUser;
const signIn = signInWithPassword;

describe("auth ordering and capability handling (IMP-041)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetInMemoryLockoutForTests();
  });

  describe("login authorization and lockout ordering", () => {
    it("rejects locked account immediately without invoking Argon2 verification", async () => {
      const { auth, db } = buildAuth();
      await addUser(db, {
        id: "usr_locked",
        email: "locked@example.com",
        password: "Password123!",
        emailVerified: true,
      });
      // Simulate account lockout for this client pair
      for (let i = 0; i < 5; i++) {
        await recordFailedAttempt("locked@example.com", CLIENT_IP);
      }
      expect(await isAccountLocked("locked@example.com", CLIENT_IP)).toBe(true);
      vi.mocked(argon2.verify).mockClear();
      vi.mocked(argon2.hash).mockClear();

      const result = await signIn(auth, "locked@example.com", "Password123!");

      expect(result.status).toBe(429);
      expect(result.body.code).toBe("ACCOUNT_LOCKED");
      // Argon2 must NOT run for a locked attempt
      expect(argon2.verify).not.toHaveBeenCalled();
      expect(argon2.hash).not.toHaveBeenCalled();
      expect(db.session).toHaveLength(0);
    });

    it("spends Argon2 work on unknown user and returns the generic error", async () => {
      const { auth } = buildAuth();

      const result = await signIn(auth, "unknown@example.com", "Password123!");

      expect(result.status).toBe(401);
      expect(result.body.code).toBe("INVALID_EMAIL_OR_PASSWORD");
      expect(argon2.hash).toHaveBeenCalled();
      // The miss counts towards the lockout like a wrong password does.
      for (let i = 0; i < 4; i++) {
        await signIn(auth, "unknown@example.com", "Password123!");
      }
      expect(await isAccountLocked("unknown@example.com", CLIENT_IP)).toBe(
        true,
      );
    });

    it("does not expose unverified email state when password is wrong", async () => {
      const { auth, db } = buildAuth({ requireEmailVerification: true });
      await addUser(db, {
        id: "usr_123",
        email: "unverified@example.com",
        password: "CorrectPassword123!",
        emailVerified: false,
      });

      // Attacker guessing wrong password for an unverified account
      const result = await signIn(
        auth,
        "unverified@example.com",
        "WrongPassword123!",
      );

      // Must be the generic error instead of EMAIL_NOT_VERIFIED
      expect(result.status).toBe(401);
      expect(result.body.code).toBe("INVALID_EMAIL_OR_PASSWORD");
    });

    it("rejects an unverified email only when the password is correct and verification is required", async () => {
      const verifiedRequired = buildAuth({ requireEmailVerification: true });
      await addUser(verifiedRequired.db, {
        id: "usr_123",
        email: "unverified@example.com",
        password: "CorrectPassword123!",
        emailVerified: false,
      });

      const rejected = await signIn(
        verifiedRequired.auth,
        "unverified@example.com",
        "CorrectPassword123!",
      );
      expect(rejected.status).toBe(403);
      expect(rejected.body.code).toBe("EMAIL_NOT_VERIFIED");
      expect(verifiedRequired.db.session).toHaveLength(0);

      // Development keeps the previous behaviour: verification is advisory.
      const development = buildAuth({ requireEmailVerification: false });
      await addUser(development.db, {
        id: "usr_123",
        email: "unverified@example.com",
        password: "CorrectPassword123!",
        emailVerified: false,
      });
      const allowed = await signIn(
        development.auth,
        "unverified@example.com",
        "CorrectPassword123!",
      );
      expect(allowed.status).toBe(200);
    });

    it("clears failed attempts on successful login and issues a server-side session cookie", async () => {
      const { auth, db } = buildAuth({ requireEmailVerification: true });
      await addUser(db, {
        id: "usr_123",
        email: "verified@example.com",
        password: "CorrectPassword123!",
        emailVerified: true,
        name: "Verified User",
      });

      // Record a few failed attempts first
      await recordFailedAttempt("verified@example.com", CLIENT_IP);
      await recordFailedAttempt("verified@example.com", CLIENT_IP);

      const jar = new CookieJar();
      const result = await signIn(
        auth,
        "Verified@Example.com",
        "CorrectPassword123!",
        jar,
      );

      expect(result.status).toBe(200);
      expect(result.body.user).toMatchObject({
        id: "usr_123",
        email: "verified@example.com",
        name: "Verified User",
      });
      expect(result.body.user.password).toBeUndefined();
      expect(db.session).toHaveLength(1);
      const setCookie = result.response.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith("memoria.session_token="));
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);

      // The cookie resolves to the same user through the session endpoint.
      const session = await callAuth(auth.handler, jar, "/get-session");
      expect(session.body.user.id).toBe("usr_123");

      // Attempts should be cleared
      for (let i = 0; i < 4; i++) {
        await signIn(auth, "verified@example.com", "WrongPassword123!");
      }
      expect(await isAccountLocked("verified@example.com", CLIENT_IP)).toBe(
        false,
      );
    });

    it("keeps an Argon2id hash created before the migration valid", async () => {
      const { auth, db } = buildAuth({ requireEmailVerification: true });
      // A fixed hash produced before the migration with the argon2 package
      // defaults (m=64 MiB, t=3, p=4), unlike today's hashPassword parameters
      // (m=19 MiB, t=2, p=1). It is stored verbatim; nothing rehashes it.
      const legacyHash =
        "$argon2id$v=19$m=65536,p=4,t=3$0GobO6eZTvZaWo8yUmJZKw$XKDYV3jjgfjWlYvomjUR0IeKZDpf9JA4J13AEkUiVhw";
      await addUser(db, {
        id: "usr_legacy",
        email: "legacy@example.com",
        passwordHash: legacyHash,
        emailVerified: true,
        name: "Legacy",
      });

      const result = await signIn(
        auth,
        "legacy@example.com",
        "Legacy-Password-42!",
      );
      expect(result.status).toBe(200);
      expect(result.body.user.id).toBe("usr_legacy");
    });

    it("lets credential and account endpoints outside the allowlist return 404", async () => {
      const { auth } = buildAuth();
      const jar = new CookieJar();
      for (const path of [
        "/sign-up/email",
        "/request-password-reset",
        "/reset-password",
        "/reset-password/some-token",
        "/change-password",
        "/update-user",
        "/delete-user",
        "/verify-password",
        "/verify-email",
        "/callback/github",
        "/sign-in/social",
        "/two-factor/get-totp-uri",
        "/two-factor/send-otp",
      ]) {
        const result = await callAuth(auth.handler, jar, path, {
          method: "POST",
          body: {},
        });
        expect(result.status, path).toBe(404);
      }
    });
  });

  describe("canvas metadata role-aware redaction", () => {
    it("returns shareToken to owner and redacts shareToken for collaborator", async () => {
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
      const ownerRes = await canvasGet(ownerReq, {
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
      const collabRes = await canvasGet(collabReq, {
        params: Promise.resolve({ canvasId: "canvas_123" }),
      });
      const collabBody = await collabRes.json();

      expect(collabRes.status).toBe(200);
      expect(collabBody.shareToken).toBeNull();
      expect(collabBody.accessLevel).toBe("EDIT");
    });
  });
});
