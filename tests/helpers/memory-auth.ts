/**
 * A Better Auth instance with Memoria's production configuration backed by
 * the in-memory adapter. Test files must mock `@/lib/db` and
 * `@/lib/cache/redis-client` before importing this module.
 */

import * as argon2 from "argon2";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createMemoriaAuth } from "@/lib/auth/server";
import { callAuth, CookieJar, TEST_ORIGIN } from "./auth-harness";

export const TEST_CLIENT_IP = "203.0.113.10";

export type MemoryDb = Record<string, Record<string, unknown>[]>;

export function buildMemoryAuth(
  options: { requireEmailVerification?: boolean } = {},
) {
  const db: MemoryDb = {
    user: [],
    session: [],
    account: [],
    verification: [],
    twoFactor: [],
    passkey: [],
  };
  const auth = createMemoriaAuth({
    database: memoryAdapter(db),
    publicUrl: TEST_ORIGIN,
    secret: "test-better-auth-secret-0123456789abcdef-0123456789",
    requireEmailVerification: options.requireEmailVerification ?? false,
    generateId: () => crypto.randomUUID(),
  });
  return { auth, db };
}

export type MemoryAuth = ReturnType<typeof buildMemoryAuth>["auth"];

export async function addCredentialUser(
  db: MemoryDb,
  user: {
    id: string;
    email: string;
    password?: string;
    passwordHash?: string;
    emailVerified: boolean;
    name?: string;
  },
) {
  const now = new Date();
  db.user.push({
    id: user.id,
    email: user.email,
    name: user.name ?? "Test User",
    image: null,
    emailVerified: user.emailVerified,
    twoFactorEnabled: false,
    createdAt: now,
    updatedAt: now,
  });
  db.account.push({
    id: `cred_${user.id}`,
    userId: user.id,
    accountId: user.id,
    providerId: "credential",
    password:
      user.passwordHash ??
      (await argon2.hash(user.password ?? "", { type: argon2.argon2id })),
    createdAt: now,
    updatedAt: now,
  });
}

export function signInWithPassword(
  auth: MemoryAuth,
  email: string,
  password: string,
  jar = new CookieJar(),
) {
  return callAuth(auth.handler, jar, "/sign-in/email", {
    body: { email, password },
    headers: { "x-memoria-client-ip": TEST_CLIENT_IP },
  });
}
