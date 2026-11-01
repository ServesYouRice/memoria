/**
 * IMP-041: passkey and authenticator-app (TOTP) enrolment and sign-in,
 * driven through Memoria's Better Auth configuration over HTTP.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetInMemoryLockoutForTests } from "@/lib/auth/account-lockout";
import {
  callAuth,
  CookieJar,
  SoftwarePasskey,
  totpFromUri,
} from "../helpers/auth-harness";
import {
  addCredentialUser,
  buildMemoryAuth,
  signInWithPassword,
  type MemoryAuth,
} from "../helpers/memory-auth";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));

const EMAIL = "factors@example.com";
const PASSWORD = "Correct-Horse-Battery-Staple-42!";

async function signedInUser() {
  const { auth, db } = buildMemoryAuth({ requireEmailVerification: true });
  await addCredentialUser(db, {
    id: "usr_factors",
    email: EMAIL,
    password: PASSWORD,
    emailVerified: true,
  });
  const jar = new CookieJar();
  const signIn = await signInWithPassword(auth, EMAIL, PASSWORD, jar);
  expect(signIn.status).toBe(200);
  return { auth, db, jar };
}

async function sessionUserId(auth: MemoryAuth, jar: CookieJar) {
  const session = await callAuth(auth.handler, jar, "/get-session");
  return (session.body?.user?.id as string | undefined) ?? null;
}

async function enrolTotp(auth: MemoryAuth, jar: CookieJar) {
  const enable = await callAuth(auth.handler, jar, "/two-factor/enable", {
    body: { password: PASSWORD },
  });
  expect(enable.status).toBe(200);
  const totpURI = enable.body.totpURI as string;
  expect(totpURI).toMatch(/^otpauth:\/\/totp\/Memoria:/);
  expect(enable.body.backupCodes.length).toBeGreaterThan(0);
  const verify = await callAuth(auth.handler, jar, "/two-factor/verify-totp", {
    body: { code: totpFromUri(totpURI) },
  });
  expect(verify.status).toBe(200);
  return { totpURI, backupCodes: enable.body.backupCodes as string[] };
}

// These tests run real Argon2id hashes (production parameters, several per
// test); on a loaded machine that alone can pass the default 5 s timeout.
vi.setConfig({ testTimeout: 30_000 });

describe("authenticator-app two-factor (IMP-041)", () => {
  beforeEach(() => resetInMemoryLockoutForTests());

  it("requires the account password to start enrolment", async () => {
    const { auth, jar, db } = await signedInUser();
    const enable = await callAuth(auth.handler, jar, "/two-factor/enable", {
      body: { password: "not-the-password" },
    });
    expect(enable.status).toBe(400);
    expect(db.twoFactor).toHaveLength(0);
  });

  it("enrols only after a valid code and stores the secret encrypted", async () => {
    const { auth, jar, db } = await signedInUser();
    const enable = await callAuth(auth.handler, jar, "/two-factor/enable", {
      body: { password: PASSWORD },
    });
    const totpURI = enable.body.totpURI as string;
    const secret = new URL(totpURI).searchParams.get("secret")!;
    expect(db.twoFactor).toHaveLength(1);
    expect(JSON.stringify(db.twoFactor[0])).not.toContain(secret);
    expect(db.user[0].twoFactorEnabled).toBe(false);

    const wrong = await callAuth(auth.handler, jar, "/two-factor/verify-totp", {
      body: { code: "000000" === totpFromUri(totpURI) ? "111111" : "000000" },
    });
    expect(wrong.status).toBe(401);
    expect(db.user[0].twoFactorEnabled).toBe(false);

    await callAuth(auth.handler, jar, "/two-factor/verify-totp", {
      body: { code: totpFromUri(totpURI) },
    });
    expect(db.user[0].twoFactorEnabled).toBe(true);
    // Enrolment rotates the session; the browser stays signed in.
    expect(await sessionUserId(auth, jar)).toBe("usr_factors");
  });

  it("holds password sign-in until the authenticator code is verified", async () => {
    const { auth, jar } = await signedInUser();
    const { totpURI } = await enrolTotp(auth, jar);

    const fresh = new CookieJar();
    const first = await signInWithPassword(auth, EMAIL, PASSWORD, fresh);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ twoFactorRedirect: true });
    expect(first.body.twoFactorMethods).toEqual(["totp"]);
    // No session exists yet: only the pending two-factor challenge cookie.
    expect(await sessionUserId(auth, fresh)).toBeNull();
    expect(fresh.names()).toContain("memoria.two_factor");

    const wrongCode = totpFromUri(totpURI) === "123456" ? "654321" : "123456";
    const rejected = await callAuth(
      auth.handler,
      fresh,
      "/two-factor/verify-totp",
      { body: { code: wrongCode } },
    );
    expect(rejected.status).toBe(401);
    expect(await sessionUserId(auth, fresh)).toBeNull();

    const accepted = await callAuth(
      auth.handler,
      fresh,
      "/two-factor/verify-totp",
      { body: { code: totpFromUri(totpURI) } },
    );
    expect(accepted.status).toBe(200);
    expect(await sessionUserId(auth, fresh)).toBe("usr_factors");
  });

  it("accepts a single-use backup code instead of the authenticator code", async () => {
    const { auth, jar } = await signedInUser();
    const { backupCodes } = await enrolTotp(auth, jar);

    const first = new CookieJar();
    await signInWithPassword(auth, EMAIL, PASSWORD, first);
    const used = await callAuth(
      auth.handler,
      first,
      "/two-factor/verify-backup-code",
      { body: { code: backupCodes[0] } },
    );
    expect(used.status).toBe(200);
    expect(await sessionUserId(auth, first)).toBe("usr_factors");

    const second = new CookieJar();
    await signInWithPassword(auth, EMAIL, PASSWORD, second);
    const reused = await callAuth(
      auth.handler,
      second,
      "/two-factor/verify-backup-code",
      { body: { code: backupCodes[0] } },
    );
    expect(reused.status).toBe(401);
    expect(await sessionUserId(auth, second)).toBeNull();
  });

  it("ends a pending challenge after repeated wrong codes", async () => {
    const { auth, jar } = await signedInUser();
    const { totpURI } = await enrolTotp(auth, jar);
    const fresh = new CookieJar();
    await signInWithPassword(auth, EMAIL, PASSWORD, fresh);
    const wrongCode = totpFromUri(totpURI) === "123456" ? "654321" : "123456";
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const result = await callAuth(
        auth.handler,
        fresh,
        "/two-factor/verify-totp",
        { body: { code: wrongCode } },
      );
      statuses.push(result.status);
    }
    expect(statuses.slice(0, 5).every((status) => status === 401)).toBe(true);
    expect(statuses[5]).toBe(400);
    // Even the right code no longer completes this challenge.
    const late = await callAuth(
      auth.handler,
      fresh,
      "/two-factor/verify-totp",
      { body: { code: totpFromUri(totpURI) } },
    );
    expect(late.status).toBe(401);
    expect(await sessionUserId(auth, fresh)).toBeNull();
  });

  it("turns two-factor off only with the password", async () => {
    const { auth, jar, db } = await signedInUser();
    await enrolTotp(auth, jar);
    const wrong = await callAuth(auth.handler, jar, "/two-factor/disable", {
      body: { password: "nope-nope-nope" },
    });
    expect(wrong.status).toBe(400);
    expect(db.user[0].twoFactorEnabled).toBe(true);

    const disabled = await callAuth(auth.handler, jar, "/two-factor/disable", {
      body: { password: PASSWORD },
    });
    expect(disabled.status).toBe(200);
    expect(db.user[0].twoFactorEnabled).toBe(false);
    const plain = await signInWithPassword(auth, EMAIL, PASSWORD);
    expect(plain.body.twoFactorRedirect).toBeUndefined();
    expect(plain.body.user.id).toBe("usr_factors");
  });
});

describe("passkeys (IMP-041)", () => {
  beforeEach(() => resetInMemoryLockoutForTests());

  async function registerPasskey(
    auth: MemoryAuth,
    jar: CookieJar,
    authenticator: SoftwarePasskey,
    options: { userVerified?: boolean } = {},
  ) {
    const registerOptions = await callAuth(
      auth.handler,
      jar,
      "/passkey/generate-register-options",
    );
    expect(registerOptions.status).toBe(200);
    expect(registerOptions.body.rp).toMatchObject({
      id: "localhost",
      name: "Memoria",
    });
    expect(registerOptions.body.authenticatorSelection.userVerification).toBe(
      "required",
    );
    return callAuth(auth.handler, jar, "/passkey/verify-registration", {
      body: {
        response: authenticator.register(registerOptions.body, options),
        name: "Test key",
      },
    });
  }

  async function passkeySignIn(
    auth: MemoryAuth,
    jar: CookieJar,
    authenticator: SoftwarePasskey,
    options: { userVerified?: boolean } = {},
  ) {
    const authOptions = await callAuth(
      auth.handler,
      jar,
      "/passkey/generate-authenticate-options",
    );
    expect(authOptions.status).toBe(200);
    return callAuth(auth.handler, jar, "/passkey/verify-authentication", {
      body: { response: authenticator.authenticate(authOptions.body, options) },
    });
  }

  it("requires a signed-in session to enrol", async () => {
    const { auth } = buildMemoryAuth();
    const anonymous = await callAuth(
      auth.handler,
      new CookieJar(),
      "/passkey/generate-register-options",
    );
    expect(anonymous.status).toBe(401);
  });

  it("enrols a passkey and signs in with it, without a password", async () => {
    const { auth, jar, db } = await signedInUser();
    const authenticator = new SoftwarePasskey();
    const registered = await registerPasskey(auth, jar, authenticator);
    expect(registered.status).toBe(200);
    expect(db.passkey).toHaveLength(1);
    expect(db.passkey[0]).toMatchObject({
      userId: "usr_factors",
      name: "Test key",
      credentialID: authenticator.credentialId.toString("base64url"),
    });

    const listed = await callAuth(
      auth.handler,
      jar,
      "/passkey/list-user-passkeys",
    );
    expect(listed.body).toHaveLength(1);

    const browser = new CookieJar();
    const signIn = await passkeySignIn(auth, browser, authenticator);
    expect(signIn.status).toBe(200);
    expect(await sessionUserId(auth, browser)).toBe("usr_factors");
    // The signature counter advances, so a replayed assertion is detectable.
    expect(db.passkey[0].counter).toBe(1);
  });

  it("rejects passkeys that do not verify the user", async () => {
    const { auth, jar, db } = await signedInUser();
    const presenceOnly = new SoftwarePasskey();
    const registered = await registerPasskey(auth, jar, presenceOnly, {
      userVerified: false,
    });
    expect(registered.status).toBe(400);
    expect(db.passkey).toHaveLength(0);

    const authenticator = new SoftwarePasskey();
    expect((await registerPasskey(auth, jar, authenticator)).status).toBe(200);
    const browser = new CookieJar();
    const signIn = await passkeySignIn(auth, browser, authenticator, {
      userVerified: false,
    });
    expect(signIn.status).toBe(401);
    expect(signIn.body.code).toBe("PASSKEY_USER_VERIFICATION_REQUIRED");
    expect(await sessionUserId(auth, browser)).toBeNull();
  });

  it("rejects an assertion from an unknown credential", async () => {
    const { auth, jar } = await signedInUser();
    await registerPasskey(auth, jar, new SoftwarePasskey());
    const browser = new CookieJar();
    const signIn = await passkeySignIn(auth, browser, new SoftwarePasskey());
    expect(signIn.status).toBe(401);
    expect(await sessionUserId(auth, browser)).toBeNull();
  });

  it("removes a passkey so it can no longer sign in", async () => {
    const { auth, jar, db } = await signedInUser();
    const authenticator = new SoftwarePasskey();
    await registerPasskey(auth, jar, authenticator);
    const removed = await callAuth(
      auth.handler,
      jar,
      "/passkey/delete-passkey",
      { body: { id: db.passkey[0].id } },
    );
    expect(removed.status).toBe(200);
    expect(db.passkey).toHaveLength(0);

    const browser = new CookieJar();
    const signIn = await passkeySignIn(auth, browser, authenticator);
    expect(signIn.status).toBe(401);
  });
});

describe("session revocation (IMP-041)", () => {
  beforeEach(() => resetInMemoryLockoutForTests());

  it("signs out other sessions while keeping the current one", async () => {
    const { auth, jar } = await signedInUser();
    const other = new CookieJar();
    await signInWithPassword(auth, EMAIL, PASSWORD, other);
    expect(await sessionUserId(auth, other)).toBe("usr_factors");

    const revoked = await callAuth(
      auth.handler,
      jar,
      "/revoke-other-sessions",
      { body: {} },
    );
    expect(revoked.status).toBe(200);
    expect(await sessionUserId(auth, other)).toBeNull();
    expect(await sessionUserId(auth, jar)).toBe("usr_factors");
  });

  it("stops accepting a cookie once its session row is deleted", async () => {
    const { auth, jar, db } = await signedInUser();
    db.session.length = 0;
    expect(await sessionUserId(auth, jar)).toBeNull();
  });
});
