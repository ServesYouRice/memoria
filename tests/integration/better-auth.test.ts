/**
 * IMP-041: Memoria's Better Auth configuration against real PostgreSQL through
 * the Prisma adapter and the migrated schema (credential accounts, database
 * sessions, TOTP, passkeys, revocation, and account-deletion cascades).
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));

import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { createMemoriaAuth } from "@/lib/auth/server";
import { getSessionFromHeaders } from "@/lib/auth/session";
import { createCredentialAccount } from "@/lib/auth/credentials";
import { hashPassword } from "@/lib/auth/password";
import { resetInMemoryLockoutForTests } from "@/lib/auth/account-lockout";
import {
  callAuth,
  CookieJar,
  SoftwarePasskey,
  TEST_ORIGIN,
  totpFromUri,
} from "../helpers/auth-harness";

const PASSWORD = "Correct-Horse-Battery-Staple-42!";
// An Argon2id hash in the exact format stored by the Auth.js credentials
// provider before the migration; the migration copies it unchanged.
const LEGACY_PASSWORD = "Legacy-Password-42!";
const LEGACY_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$0GobO6eZTvZaWo8yUmJZKw$XKDYV3jjgfjWlYvomjUR0IeKZDpf9JA4J13AEkUiVhw";

// The same configuration getAuthServer() builds, with production's
// email-verification requirement and the process secret so session reads
// through the shared helper validate the cookies it signs.
const auth = createMemoriaAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  publicUrl: env.AUTH_URL,
  secret: env.AUTH_SECRET,
  requireEmailVerification: true,
});

let counter = 0;
async function createUser(
  options: { emailVerified?: boolean; passwordHash?: string } = {},
) {
  counter += 1;
  const email = `better-auth-${Date.now()}-${counter}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      name: "Better Auth",
      emailVerified: options.emailVerified ?? true,
      emailVerifiedAt: options.emailVerified === false ? null : new Date(),
    },
  });
  await createCredentialAccount(
    prisma,
    user.id,
    options.passwordHash ?? (await hashPassword(PASSWORD)),
  );
  return user;
}

function signIn(email: string, password: string, jar = new CookieJar()) {
  return callAuth(auth.handler, jar, "/sign-in/email", {
    body: { email, password },
  });
}

async function readSession(jar: CookieJar) {
  return getSessionFromHeaders(new Headers({ cookie: jar.header() }), {
    refresh: false,
  });
}

beforeEach(() => {
  expect(env.AUTH_URL).toBe(TEST_ORIGIN);
  resetInMemoryLockoutForTests();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Better Auth on PostgreSQL (IMP-041)", () => {
  it("signs in with a pre-migration Argon2 hash and stores a database session", async () => {
    const user = await createUser({ passwordHash: LEGACY_HASH });
    const jar = new CookieJar();

    const result = await signIn(user.email, LEGACY_PASSWORD, jar);

    expect(result.status).toBe(200);
    expect(jar.has("memoria.session_token")).toBe(true);
    const rows = await prisma.session.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].ipAddress).toBe("203.0.113.10");
    // The cookie carries the signed token, never the row id.
    expect(jar.header()).not.toContain(rows[0].id);

    const session = await readSession(jar);
    expect(session).toMatchObject({
      user: { id: user.id, email: user.email, emailVerified: true },
      session: { id: rows[0].id, userId: user.id },
    });
  });

  it("rejects a wrong password without creating a session", async () => {
    const user = await createUser();
    const result = await signIn(user.email, "wrong-password-123");
    expect(result.status).toBe(401);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("refuses unverified addresses only after the password is correct", async () => {
    const user = await createUser({ emailVerified: false });

    const wrong = await signIn(user.email, "wrong-password-123");
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).not.toBe("EMAIL_NOT_VERIFIED");

    const right = await signIn(user.email, PASSWORD);
    expect(right.status).toBe(403);
    expect(right.body.code).toBe("EMAIL_NOT_VERIFIED");
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("revokes immediately when session rows are deleted", async () => {
    const user = await createUser();
    const jar = new CookieJar();
    await signIn(user.email, PASSWORD, jar);
    expect(await readSession(jar)).not.toBeNull();

    // What password change, reset, and deletion do inside their transactions.
    await prisma.session.deleteMany({ where: { userId: user.id } });

    expect(await readSession(jar)).toBeNull();
  });

  it("revokes other sessions but keeps the current one", async () => {
    const user = await createUser();
    const laptop = new CookieJar();
    const phone = new CookieJar();
    await signIn(user.email, PASSWORD, laptop);
    await signIn(user.email, PASSWORD, phone);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);

    const revoked = await callAuth(
      auth.handler,
      laptop,
      "/revoke-other-sessions",
      { body: {} },
    );
    expect(revoked.status).toBe(200);
    expect(await readSession(laptop)).not.toBeNull();
    expect(await readSession(phone)).toBeNull();
  });

  it("enrols TOTP with an encrypted secret and requires it at sign-in", async () => {
    const user = await createUser();
    const jar = new CookieJar();
    await signIn(user.email, PASSWORD, jar);

    const enable = await callAuth(auth.handler, jar, "/two-factor/enable", {
      body: { password: PASSWORD },
    });
    expect(enable.status).toBe(200);
    const totpURI = enable.body.totpURI as string;
    const secret = new URL(totpURI).searchParams.get("secret")!;
    const verify = await callAuth(
      auth.handler,
      jar,
      "/two-factor/verify-totp",
      {
        body: { code: totpFromUri(totpURI) },
      },
    );
    expect(verify.status).toBe(200);

    const stored = await prisma.twoFactor.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(stored.secret).not.toContain(secret);
    expect(stored.backupCodes).not.toContain(enable.body.backupCodes[0]);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .twoFactorEnabled,
    ).toBe(true);

    const fresh = new CookieJar();
    const first = await signIn(user.email, PASSWORD, fresh);
    expect(first.body).toMatchObject({ twoFactorRedirect: true });
    expect(await readSession(fresh)).toBeNull();
    const second = await callAuth(
      auth.handler,
      fresh,
      "/two-factor/verify-totp",
      { body: { code: totpFromUri(totpURI) } },
    );
    expect(second.status).toBe(200);
    expect((await readSession(fresh))?.user.id).toBe(user.id);
  });

  it("enrols a passkey, signs in with it, and cascades on account deletion", async () => {
    const user = await createUser();
    const jar = new CookieJar();
    await signIn(user.email, PASSWORD, jar);
    const authenticator = new SoftwarePasskey();

    const registerOptions = await callAuth(
      auth.handler,
      jar,
      "/passkey/generate-register-options",
    );
    const registered = await callAuth(
      auth.handler,
      jar,
      "/passkey/verify-registration",
      {
        body: {
          response: authenticator.register(registerOptions.body),
          name: "Laptop",
        },
      },
    );
    expect(registered.status).toBe(200);
    const stored = await prisma.passkey.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(stored).toMatchObject({ name: "Laptop", counter: 0 });

    const browser = new CookieJar();
    const authOptions = await callAuth(
      auth.handler,
      browser,
      "/passkey/generate-authenticate-options",
    );
    const passkeySignIn = await callAuth(
      auth.handler,
      browser,
      "/passkey/verify-authentication",
      { body: { response: authenticator.authenticate(authOptions.body) } },
    );
    expect(passkeySignIn.status).toBe(200);
    expect((await readSession(browser))?.user.id).toBe(user.id);
    expect(
      (await prisma.passkey.findUniqueOrThrow({ where: { id: stored.id } }))
        .counter,
    ).toBe(1);

    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.passkey.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.account.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await readSession(browser)).toBeNull();
  });
});
