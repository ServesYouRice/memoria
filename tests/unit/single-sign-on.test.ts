/**
 * IMP-099: sign in with an existing login system (OpenID Connect), driven
 * through Memoria's production Better Auth configuration over HTTP against
 * a test login system that signs real ID tokens.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetInMemoryLockoutForTests } from "@/lib/auth/account-lockout";
import { ALLOWED_AUTH_PATHS, allowedAuthPaths } from "@/lib/auth/server";
import {
  DEFAULT_SSO_LABEL,
  discoveryUrl,
  ssoConfigFromEnv,
  ssoErrorMessage,
  type SsoConfig,
} from "@/lib/auth/sso";
import { strictAuthRateLimitGroup } from "@/middleware/auth-rate-limit";
import { callAuth, CookieJar, SoftwarePasskey } from "../helpers/auth-harness";
import {
  addCredentialUser,
  buildMemoryAuth,
  signInWithPassword,
  type MemoryAuth,
} from "../helpers/memory-auth";
import {
  FAKE_CLIENT_ID,
  FAKE_CLIENT_SECRET,
  FAKE_ISSUER,
  FakeLoginSystem,
  signInWithLoginSystem,
} from "../helpers/fake-oidc";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));

const SSO: SsoConfig = {
  issuer: FAKE_ISSUER,
  clientId: FAKE_CLIENT_ID,
  clientSecret: FAKE_CLIENT_SECRET,
  label: "Home Login",
};

let idp: FakeLoginSystem;

beforeEach(async () => {
  await resetInMemoryLockoutForTests();
  idp = new FakeLoginSystem();
  idp.install();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function build(options: { signUp?: boolean } = {}) {
  const created: string[] = [];
  const built = buildMemoryAuth({
    requireEmailVerification: true,
    sso: SSO,
    ssoSignUp: options.signUp ?? false,
    onUserCreated: async (userId) => {
      created.push(userId);
    },
  });
  return { ...built, created };
}

async function sessionUser(auth: MemoryAuth, jar: CookieJar) {
  const session = await callAuth(auth.handler, jar, "/get-session");
  return (session.body?.user ?? null) as {
    id: string;
    email: string;
  } | null;
}

describe("Settings (IMP-099)", () => {
  it("is off unless issuer, client id and secret are all set", () => {
    expect(ssoConfigFromEnv({})).toBeNull();
    expect(
      ssoConfigFromEnv({ OIDC_ISSUER: FAKE_ISSUER, OIDC_CLIENT_ID: "x" }),
    ).toBeNull();
    expect(
      ssoConfigFromEnv({
        OIDC_ISSUER: `${FAKE_ISSUER}/`,
        OIDC_CLIENT_ID: "x",
        OIDC_CLIENT_SECRET: "y",
      }),
    ).toEqual({
      issuer: FAKE_ISSUER,
      clientId: "x",
      clientSecret: "y",
      label: DEFAULT_SSO_LABEL,
    });
    expect(discoveryUrl(`${FAKE_ISSUER}/`)).toBe(
      `${FAKE_ISSUER}/.well-known/openid-configuration`,
    );
  });

  it("opens only the sign-in start and return paths, and limits the start", () => {
    expect(allowedAuthPaths(false)).toBe(ALLOWED_AUTH_PATHS);
    expect(ALLOWED_AUTH_PATHS.has("/sign-in/social")).toBe(false);
    const on = allowedAuthPaths(true);
    expect(on.has("/sign-in/social")).toBe(true);
    expect(on.has("/callback/oidc")).toBe(true);
    expect(on.has("/link-social")).toBe(false);
    expect(on.has("/callback/github")).toBe(false);
    expect(strictAuthRateLimitGroup("/api/auth/sign-in/social", "POST")).toBe(
      "sign-in",
    );
  });

  it("explains each refusal in plain words", () => {
    expect(ssoErrorMessage(null)).toBeNull();
    expect(ssoErrorMessage("signup_disabled")).toContain("invite");
    expect(ssoErrorMessage("account_not_linked")).toContain("already exists");
    expect(ssoErrorMessage("email_not_verified")).toContain("did not confirm");
    expect(ssoErrorMessage("anything_else")).toContain("did not work");
  });
});

describe("Without the settings (IMP-099)", () => {
  it("keeps social sign-in and its callback closed", async () => {
    const { auth } = buildMemoryAuth();
    const jar = new CookieJar();
    const start = await callAuth(auth.handler, jar, "/sign-in/social", {
      body: { provider: "oidc", callbackURL: "/dashboard" },
    });
    expect(start.status).toBe(404);
    const back = await callAuth(auth.handler, jar, "/callback/oidc", {
      query: { code: "x", state: "y" },
    });
    expect(back.status).toBe(404);
  });
});

describe("Sign in with an existing login system (IMP-099)", () => {
  it("creates an account in open registration, with its starter Inbox, and signs in", async () => {
    const { auth, db, created } = build({ signUp: true });
    const jar = new CookieJar();
    const result = await signInWithLoginSystem(auth.handler, jar, idp, {
      sub: "kc-new",
      email: "New.Person@example.com",
      email_verified: true,
      name: "New Person",
    });
    expect(result.status).toBe(302);
    expect(result.location).toContain("/dashboard");
    // The standard, safe flow: code + PKCE, signed ID token checked.
    expect(result.authorizeUrl.searchParams.get("response_type")).toBe("code");
    expect(result.authorizeUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(result.authorizeUrl.searchParams.get("scope")).toContain("email");
    expect(result.authorizeUrl.searchParams.has("client_secret")).toBe(false);
    expect(idp.tokenRequests).toHaveLength(1);

    const user = await sessionUser(auth, jar);
    expect(user?.email).toBe("new.person@example.com");
    expect(created).toEqual([user!.id]);
    expect(db.account).toContainEqual(
      expect.objectContaining({
        userId: user!.id,
        providerId: "oidc",
        accountId: "kc-new",
      }),
    );
  });

  it("refuses a new person in invite and closed modes", async () => {
    const { auth, db, created } = build({ signUp: false });
    const jar = new CookieJar();
    const result = await signInWithLoginSystem(auth.handler, jar, idp, {
      sub: "kc-stranger",
      email: "stranger@example.com",
      email_verified: true,
    });
    expect(result.location).toContain("/auth/login");
    expect(result.location).toContain("error=signup_disabled");
    expect(db.user).toHaveLength(0);
    expect(created).toEqual([]);
    expect(await sessionUser(auth, jar)).toBeNull();
  });

  it("joins an existing account only when both sides have verified the same email", async () => {
    const { auth, db } = build();
    await addCredentialUser(db, {
      id: "usr_verified",
      email: "owner@example.com",
      password: "Correct-Horse-Battery-Staple-42!",
      emailVerified: true,
    });

    // The login system does not vouch for the email: nothing is joined.
    const unverifiedJar = new CookieJar();
    const unverified = await signInWithLoginSystem(
      auth.handler,
      unverifiedJar,
      idp,
      { sub: "kc-owner", email: "owner@example.com", email_verified: false },
    );
    expect(unverified.location).toMatch(
      /error=(account_not_linked|email_not_verified)/,
    );
    expect(await sessionUser(auth, unverifiedJar)).toBeNull();
    expect(db.account.filter((a) => a.providerId === "oidc")).toHaveLength(0);

    // Both verified: joined to the existing account, no second account.
    const jar = new CookieJar();
    const joined = await signInWithLoginSystem(auth.handler, jar, idp, {
      sub: "kc-owner",
      email: "OWNER@example.com",
      email_verified: true,
    });
    expect(joined.location).toContain("/dashboard");
    expect((await sessionUser(auth, jar))?.id).toBe("usr_verified");
    expect(db.user).toHaveLength(1);

    // Next time the same login signs straight in.
    const again = new CookieJar();
    await signInWithLoginSystem(auth.handler, again, idp, {
      sub: "kc-owner",
      email: "owner@example.com",
      email_verified: true,
    });
    expect((await sessionUser(auth, again))?.id).toBe("usr_verified");
  });

  it("does not join an account whose email Memoria has not verified", async () => {
    const { auth, db } = build({ signUp: true });
    await addCredentialUser(db, {
      id: "usr_unverified",
      email: "squat@example.com",
      password: "Correct-Horse-Battery-Staple-42!",
      emailVerified: false,
    });
    const jar = new CookieJar();
    const result = await signInWithLoginSystem(auth.handler, jar, idp, {
      sub: "kc-real-owner",
      email: "squat@example.com",
      email_verified: true,
    });
    expect(result.location).toContain("error=account_not_linked");
    expect(await sessionUser(auth, jar)).toBeNull();
    expect(db.account.filter((a) => a.providerId === "oidc")).toHaveLength(0);
  });

  it("rejects an ID token that the login system did not sign", async () => {
    const { auth } = build({ signUp: true });
    const jar = new CookieJar();
    const start = await callAuth(auth.handler, jar, "/sign-in/social", {
      body: { provider: "oidc", callbackURL: "/dashboard" },
    });
    const back = new FakeLoginSystem().approve(start.body.url, {
      sub: "kc-forged",
      email: "forged@example.com",
      email_verified: true,
    });
    // The forged code is unknown to the real login system's token endpoint.
    const returned = await callAuth(auth.handler, jar, "/callback/oidc", {
      query: Object.fromEntries(back.searchParams),
    });
    expect(returned.response.headers.get("location")).toContain("error=");
    expect(await sessionUser(auth, jar)).toBeNull();
  });

  it("accepts only the configured login system and never a posted ID token", async () => {
    const { auth } = build({ signUp: true });
    const jar = new CookieJar();
    for (const body of [
      { provider: "github", callbackURL: "/dashboard" },
      {
        provider: "oidc",
        callbackURL: "/dashboard",
        idToken: { token: "eyJhbGciOiJub25lIn0.e30." },
      },
    ]) {
      const response = await callAuth(auth.handler, jar, "/sign-in/social", {
        body,
      });
      expect(response.status).toBe(404);
    }
  });

  it("lets a login-system-only person add a passkey and two-step codes afterwards", async () => {
    const { auth, db } = build({ signUp: true });
    const jar = new CookieJar();
    await signInWithLoginSystem(auth.handler, jar, idp, {
      sub: "kc-factors",
      email: "factors@example.com",
      email_verified: true,
    });
    expect(await sessionUser(auth, jar)).not.toBeNull();

    const passkey = new SoftwarePasskey();
    const options = await callAuth(
      auth.handler,
      jar,
      "/passkey/generate-register-options",
    );
    expect(options.status).toBe(200);
    const registered = await callAuth(
      auth.handler,
      jar,
      "/passkey/verify-registration",
      { body: { response: passkey.register(options.body) } },
    );
    expect(registered.status).toBe(200);
    expect(db.passkey).toHaveLength(1);

    // No password exists to confirm with, so none is asked.
    const enable = await callAuth(auth.handler, jar, "/two-factor/enable", {
      body: {},
    });
    expect(enable.status).toBe(200);
    expect(enable.body.totpURI).toContain("otpauth://");
  });

  it("still asks a person who has a password to confirm it for two-step codes", async () => {
    const { auth, db } = build();
    await addCredentialUser(db, {
      id: "usr_with_password",
      email: "pw@example.com",
      password: "Correct-Horse-Battery-Staple-42!",
      emailVerified: true,
    });
    const jar = new CookieJar();
    expect(
      (
        await signInWithPassword(
          auth,
          "pw@example.com",
          "Correct-Horse-Battery-Staple-42!",
          jar,
        )
      ).status,
    ).toBe(200);
    const enable = await callAuth(auth.handler, jar, "/two-factor/enable", {
      body: {},
    });
    expect(enable.status).toBe(400);
  });
});
