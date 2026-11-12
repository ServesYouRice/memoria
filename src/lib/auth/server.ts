/**
 * Better Auth server configuration (IMP-041).
 *
 * Better Auth owns sign-in, server-side sessions, passkeys, and authenticator
 * app (TOTP) two-factor. Memoria keeps its own validated routes for the flows
 * that carry product policy: registration (admission modes, zxcvbn, durable
 * verification email), email verification, password reset, password change,
 * and account deletion. Better Auth endpoints outside ALLOWED_AUTH_PATHS
 * answer 404, so there is exactly one authority for each flow.
 *
 * Session reading goes through `src/lib/auth/session.ts`; nothing else should
 * call `getAuthServer().api.getSession` directly.
 */

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
  isAPIError,
} from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins/two-factor";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { passkey } from "@better-auth/passkey";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  clearFailedAttempts,
  getLoginDelay,
  isAccountLocked,
  LockoutStoreUnavailableError,
  recordFailedAttempt,
} from "@/lib/auth/account-lockout";
import {
  SSO_CALLBACK_PATH,
  SSO_PROVIDER_ID,
  SSO_SIGN_IN_PATH,
  discoveryUrl,
  ensureStarterResources,
  ssoConfigFromEnv,
  type SsoConfig,
} from "@/lib/auth/sso";

export const AUTH_BASE_PATH = "/api/auth";
export const AUTH_COOKIE_PREFIX = "memoria";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;
/** Generous bound; registration never capped length and Argon2 prehashes. */
export const MAX_PASSWORD_LENGTH = 4096;

const SIGN_IN_EMAIL_PATH = "/sign-in/email";
/**
 * Session-backed two-factor endpoints that check the account password. A
 * wrong password there is a guess like one at sign-in, so it counts toward
 * the same lockout, and a locked account is refused before the check.
 */
const TWO_FACTOR_PASSWORD_PATHS: ReadonlySet<string> = new Set([
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/generate-backup-codes",
]);
/** Better Auth's error code for a wrong password on those endpoints. */
const INVALID_PASSWORD_CODE = "INVALID_PASSWORD";

/**
 * The only Better Auth endpoints reachable over HTTP. Everything else answers
 * 404 before Better Auth routes it. Deliberately absent:
 * - sign-up, email verification, password reset/change/set, user update,
 *   email change, and user deletion: Memoria's validated `/api/v1` routes own
 *   those flows (admission policy, zxcvbn, durable email, export/cleanup);
 * - social sign-in and its callback, unless an existing login system is
 *   configured (IMP-099; see `allowedAuthPaths`); account linking by a
 *   signed-in person and provider tokens stay closed either way;
 * - `/verify-password`: a session-backed password oracle outside lockout;
 * - two-factor email/SMS OTP: not configured, TOTP is the second factor;
 * - `/two-factor/get-totp-uri`: the secret is shown once, at enrolment;
 * - `/update-session`: there are no client-writable session fields.
 */
export const ALLOWED_AUTH_PATHS: ReadonlySet<string> = new Set([
  "/ok",
  "/error",
  "/get-session",
  "/sign-in/email",
  "/sign-out",
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/two-factor/generate-backup-codes",
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/passkey/generate-authenticate-options",
  "/passkey/verify-authentication",
  "/passkey/list-user-passkeys",
  "/passkey/update-passkey",
  "/passkey/delete-passkey",
]);

/** With a login system configured, its sign-in start and return paths too. */
export function allowedAuthPaths(ssoEnabled: boolean): ReadonlySet<string> {
  if (!ssoEnabled) return ALLOWED_AUTH_PATHS;
  return new Set([...ALLOWED_AUTH_PATHS, SSO_SIGN_IN_PATH, SSO_CALLBACK_PATH]);
}

/** Path below the auth base path, without a trailing slash. */
export function authEndpointPath(requestUrl: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(requestUrl).pathname;
  } catch {
    return null;
  }
  if (pathname !== AUTH_BASE_PATH && !pathname.startsWith(`${AUTH_BASE_PATH}/`))
    return null;
  const path = pathname.slice(AUTH_BASE_PATH.length).replace(/\/+$/, "");
  return path || "/";
}

export const AUTH_ERROR_CODES = {
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  LOGIN_SAFETY_UNAVAILABLE: "LOGIN_SAFETY_UNAVAILABLE",
  PASSKEY_USER_VERIFICATION_REQUIRED: "PASSKEY_USER_VERIFICATION_REQUIRED",
} as const;

export interface MemoriaAuthConfig {
  database: BetterAuthOptions["database"];
  /** The public address. Must equal the address people open Memoria at. */
  publicUrl: string;
  secret: string;
  /** Production refuses sign-in until the email address is verified. */
  requireEmailVerification: boolean;
  /** `false` lets PostgreSQL/Prisma assign ids (cuid defaults). */
  generateId?: false | (() => string);
  /** IMP-099: an existing OpenID Connect login system; off when absent. */
  sso?: SsoConfig | null;
  /**
   * Whether signing in with the login system may create a new account. Only
   * "open" registration allows it; "invite" and "closed" never do.
   */
  ssoSignUp?: boolean;
  /** Gives a newly created account its starting workspace and Inbox. */
  onUserCreated?: (userId: string) => Promise<void>;
}

function bodyEmail(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  return normalizeEmail((body as { email?: unknown }).email);
}

function normalizeEmail(email: unknown): string | null {
  if (typeof email !== "string" || email.trim() === "") return null;
  return email.trim().toLowerCase();
}

/** The signed-in user's email, normalized like `bodyEmail`. */
async function sessionEmail(
  ctx: Parameters<typeof getSessionFromCtx>[0],
): Promise<string | null> {
  const session = await getSessionFromCtx(ctx).catch(() => null);
  return normalizeEmail(session?.user?.email);
}

function accountLockedError() {
  return new APIError("TOO_MANY_REQUESTS", {
    code: AUTH_ERROR_CODES.ACCOUNT_LOCKED,
    message:
      "This account is temporarily locked after too many failed sign-in attempts.",
  });
}

function clientIdFrom(headers: Headers | undefined): string {
  // server.ts overwrites this header from the socket address using the
  // trusted-proxy rules. Never fall back to caller-controlled forwarding.
  return headers?.get("x-memoria-client-ip") || "unknown";
}

async function runLockoutStep<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof LockoutStoreUnavailableError) {
      throw new APIError("SERVICE_UNAVAILABLE", {
        code: AUTH_ERROR_CODES.LOGIN_SAFETY_UNAVAILABLE,
        message: error.message,
      });
    }
    throw error;
  }
}

/**
 * Account lockout and progressive delay around email/password sign-in.
 *
 * The lockout check runs before the password is hashed, so a locked pair
 * costs no Argon2 work. Better Auth itself verifies the password before it
 * evaluates email verification, and spends equal hashing work on unknown
 * accounts, so neither existence nor verification state leaks to a caller
 * without the right password.
 */
function credentialPolicy(ssoEnabled: boolean) {
  const allowed = allowedAuthPaths(ssoEnabled);
  return {
    id: "memoria-credential-policy",
    onRequest: async (request: Request) => {
      const path = authEndpointPath(request.url);
      if (path === null || !allowed.has(path)) {
        return { response: new Response("Not Found", { status: 404 }) };
      }
      return undefined;
    },
    hooks: {
      before: [
        {
          // Only the configured login system, and only the redirect flow:
          // an ID token posted straight from the browser is never accepted.
          matcher: (ctx: { path?: string }) => ctx.path === SSO_SIGN_IN_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const body = (ctx.body ?? {}) as {
              provider?: unknown;
              idToken?: unknown;
            };
            if (
              !ssoEnabled ||
              body.provider !== SSO_PROVIDER_ID ||
              body.idToken !== undefined
            ) {
              throw new APIError("NOT_FOUND", { message: "Not Found" });
            }
          }),
        },
        {
          matcher: (ctx: { path?: string }) => ctx.path === SIGN_IN_EMAIL_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const email = bodyEmail(ctx.body);
            if (!email) return;
            const clientId = clientIdFrom(ctx.headers);
            const locked = await runLockoutStep(() =>
              isAccountLocked(email, clientId),
            );
            if (locked) throw accountLockedError();
            const delayMs = await runLockoutStep(() => getLoginDelay(email));
            if (delayMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
          }),
        },
        {
          matcher: (ctx: { path?: string }) =>
            TWO_FACTOR_PASSWORD_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const email = await sessionEmail(ctx);
            if (!email) return;
            const clientId = clientIdFrom(ctx.headers);
            const locked = await runLockoutStep(() =>
              isAccountLocked(email, clientId),
            );
            if (locked) throw accountLockedError();
          }),
        },
      ],
      after: [
        {
          matcher: (ctx: { path?: string }) => ctx.path === SIGN_IN_EMAIL_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const email = bodyEmail(ctx.body);
            if (!email) return;
            const clientId = clientIdFrom(ctx.headers);
            const returned = ctx.context.returned;
            if (isAPIError(returned)) {
              if (returned.statusCode === 401) {
                await runLockoutStep(() =>
                  recordFailedAttempt(email, clientId),
                );
              }
              return;
            }
            // The password was correct: a session was issued, or a second
            // factor is now pending. Either way the guessing streak is over.
            await runLockoutStep(() => clearFailedAttempts(email, clientId));
          }),
        },
        {
          matcher: (ctx: { path?: string }) =>
            TWO_FACTOR_PASSWORD_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned;
            // Only a wrong password is a guess; other errors are not.
            if (
              !isAPIError(returned) ||
              (returned.body as { code?: unknown } | undefined)?.code !==
                INVALID_PASSWORD_CODE
            ) {
              return;
            }
            const email = await sessionEmail(ctx);
            if (!email) return;
            const clientId = clientIdFrom(ctx.headers);
            await runLockoutStep(() => recordFailedAttempt(email, clientId));
          }),
        },
      ],
    },
  };
}

export function createMemoriaAuth(config: MemoriaAuthConfig) {
  const publicOrigin = new URL(config.publicUrl).origin;
  const rpID = new URL(publicOrigin).hostname;
  const sso = config.sso ?? null;
  const onUserCreated = config.onUserCreated;

  return betterAuth({
    appName: "Memoria",
    baseURL: publicOrigin,
    basePath: AUTH_BASE_PATH,
    secret: config.secret,
    database: config.database,
    trustedOrigins: [publicOrigin],
    telemetry: { enabled: false },
    // Memoria's Redis-backed limiter in src/proxy.ts covers the credential,
    // passkey, and two-factor endpoints (src/middleware/auth-rate-limit.ts).
    // Better Auth's in-process limiter would be a second, unshared budget.
    rateLimit: { enabled: false },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: config.requireEmailVerification,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
    },
    session: {
      expiresIn: SESSION_MAX_AGE_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      cookieCache: { enabled: false },
    },
    account: {
      // Only the login system can join an existing account, and only when it
      // vouches for the email (email_verified) and Memoria has verified the
      // same address. Nothing else links; signed-in linking stays closed.
      accountLinking: sso
        ? {
            enabled: true,
            trustedProviders: [],
            requireLocalEmailVerified: true,
            allowDifferentEmails: false,
          }
        : { enabled: false },
    },
    ...(onUserCreated
      ? {
          databaseHooks: {
            user: {
              create: {
                after: async (user: { id: string }) => {
                  await onUserCreated(user.id);
                },
              },
            },
          },
        }
      : {}),
    verification: {
      storeIdentifier: "hashed",
    },
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      useSecureCookies: publicOrigin.startsWith("https://"),
      ipAddress: { ipAddressHeaders: ["x-memoria-client-ip"] },
      database: {
        generateId: config.generateId ?? false,
      },
    },
    plugins: [
      credentialPolicy(Boolean(sso)),
      twoFactor({
        issuer: "Memoria",
        // A person who only signs in with the login system has no password
        // to confirm with; a person with a password must still give it.
        allowPasswordless: true,
      }),
      ...(sso
        ? [
            genericOAuth({
              config: [
                {
                  providerId: SSO_PROVIDER_ID,
                  name: sso.label,
                  discoveryUrl: discoveryUrl(sso.issuer),
                  clientId: sso.clientId,
                  clientSecret: sso.clientSecret,
                  scopes: ["openid", "email", "profile"],
                  pkce: true,
                  requireIdTokenVerification: true,
                  requireEmailVerification: true,
                  disableSignUp: !config.ssoSignUp,
                },
              ],
            }),
          ]
        : []),
      passkey({
        rpID,
        rpName: "Memoria",
        // Pin the ceremony origin to the public address rather than trusting
        // the request's Origin header.
        origin: publicOrigin,
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "required",
        },
        authentication: {
          afterVerification: ({ verification }) => {
            // A passkey replaces password and second factor together, so it
            // must prove possession and user verification (PIN/biometric).
            if (!verification.authenticationInfo.userVerified) {
              throw new APIError("UNAUTHORIZED", {
                code: AUTH_ERROR_CODES.PASSKEY_USER_VERIFICATION_REQUIRED,
                message: "This passkey did not verify the user.",
              });
            }
          },
        },
        registration: {
          afterVerification: ({ verification }) => {
            if (!verification.registrationInfo?.userVerified) {
              throw new APIError("BAD_REQUEST", {
                code: AUTH_ERROR_CODES.PASSKEY_USER_VERIFICATION_REQUIRED,
                message: "This passkey did not verify the user.",
              });
            }
          },
        },
      }),
      // Must stay last: forwards Set-Cookie from server-side auth calls.
      nextCookies(),
    ],
  });
}

export type MemoriaAuth = ReturnType<typeof createMemoriaAuth>;

let authServer: MemoriaAuth | undefined;

/** The process-wide Better Auth instance, created on first use. */
export function getAuthServer(): MemoriaAuth {
  authServer ??= createMemoriaAuth({
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    publicUrl: env.AUTH_URL,
    secret: env.AUTH_SECRET,
    requireEmailVerification: process.env.NODE_ENV === "production",
    sso: ssoConfigFromEnv(env),
    ssoSignUp: env.REGISTRATION_MODE === "open",
    onUserCreated: (userId) => ensureStarterResources(prisma, userId),
  });
  return authServer;
}
