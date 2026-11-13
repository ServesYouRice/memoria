/**
 * A test login system (OpenID Connect provider) for IMP-099. It answers the
 * discovery, key, token and user-info requests Better Auth makes through
 * `fetch`, and signs real RS256 ID tokens, so the sign-in runs the same
 * verification as production.
 */

import {
  createSign,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import { vi } from "vitest";
import { callAuth, type CookieJar } from "./auth-harness";

export const FAKE_ISSUER = "https://login.test/realms/home";
export const FAKE_CLIENT_ID = "memoria";
export const FAKE_CLIENT_SECRET = "test-client-secret-0123456789";

export interface FakeIdentity {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

export class FakeLoginSystem {
  private readonly privateKey: KeyObject;
  private readonly jwk: Record<string, unknown>;
  private readonly codes = new Map<
    string,
    { identity: FakeIdentity; nonce: string | null }
  >();
  /** Bodies of the token requests, to check the secret stays server-side. */
  readonly tokenRequests: URLSearchParams[] = [];

  constructor() {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    this.privateKey = pair.privateKey;
    this.jwk = {
      ...pair.publicKey.export({ format: "jwk" }),
      kid: "test-key",
      alg: "RS256",
      use: "sig",
    };
  }

  /** Route `fetch` calls for the issuer here; others go to the real fetch. */
  install() {
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (!request.url.startsWith(FAKE_ISSUER)) return realFetch(input, init);
        return this.answer(request);
      },
    );
  }

  private async answer(request: Request) {
    const path = new URL(request.url).pathname.replace(
      new URL(FAKE_ISSUER).pathname,
      "",
    );
    if (path === "/.well-known/openid-configuration") {
      return Response.json({
        issuer: FAKE_ISSUER,
        authorization_endpoint: `${FAKE_ISSUER}/authorize`,
        token_endpoint: `${FAKE_ISSUER}/token`,
        userinfo_endpoint: `${FAKE_ISSUER}/userinfo`,
        jwks_uri: `${FAKE_ISSUER}/jwks`,
        id_token_signing_alg_values_supported: ["RS256"],
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
      });
    }
    if (path === "/jwks") return Response.json({ keys: [this.jwk] });
    if (path === "/token") {
      const body = new URLSearchParams(await request.text());
      this.tokenRequests.push(body);
      const grant = this.codes.get(body.get("code") ?? "");
      if (!grant)
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      this.codes.delete(body.get("code")!);
      return Response.json({
        access_token: `at-${randomBytes(8).toString("hex")}`,
        token_type: "Bearer",
        expires_in: 300,
        id_token: this.idToken(grant.identity, grant.nonce),
      });
    }
    if (path === "/userinfo") return Response.json({}, { status: 401 });
    return new Response("Not Found", { status: 404 });
  }

  private idToken(identity: FakeIdentity, nonce: string | null) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(
      JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key" }),
    );
    const payload = base64url(
      JSON.stringify({
        iss: FAKE_ISSUER,
        aud: FAKE_CLIENT_ID,
        iat: now,
        exp: now + 300,
        ...(nonce ? { nonce } : {}),
        ...identity,
      }),
    );
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${payload}`);
    return `${header}.${payload}.${signer.sign(this.privateKey).toString("base64url")}`;
  }

  /**
   * The person approves at the login system: it sends them back to
   * Memoria's callback with a one-time code.
   */
  approve(authorizeUrl: string, identity: FakeIdentity) {
    const url = new URL(authorizeUrl);
    const code = randomBytes(12).toString("hex");
    this.codes.set(code, { identity, nonce: url.searchParams.get("nonce") });
    const back = new URL(url.searchParams.get("redirect_uri")!);
    back.searchParams.set("code", code);
    back.searchParams.set("state", url.searchParams.get("state")!);
    return back;
  }
}

/**
 * Click "Sign in with ...", approve at the login system, and follow the
 * redirect back. Returns where Memoria finally sends the browser.
 */
export async function signInWithLoginSystem(
  handler: (request: Request) => Promise<Response>,
  jar: CookieJar,
  idp: FakeLoginSystem,
  identity: FakeIdentity,
  callbackURL = "/dashboard",
) {
  const start = await callAuth(handler, jar, "/sign-in/social", {
    body: {
      provider: "oidc",
      callbackURL,
      errorCallbackURL: "/auth/login",
    },
  });
  if (start.status !== 200 || !start.body?.url)
    throw new Error(`sign-in did not start: ${start.status}`);
  const authorizeUrl = start.body.url as string;
  const back = idp.approve(authorizeUrl, identity);
  const path = back.pathname.replace(/^\/api\/auth/, "");
  const returned = await callAuth(handler, jar, path, {
    method: "GET",
    query: Object.fromEntries(back.searchParams),
  });
  return {
    authorizeUrl: new URL(authorizeUrl),
    status: returned.status,
    location: returned.response.headers.get("location"),
  };
}
