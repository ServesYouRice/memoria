import NextAuth, { CredentialsSignin } from "next-auth";
import type { NextAuthConfig } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import * as argon2 from "argon2";
import {
  clearFailedAttempts,
  getLoginDelay,
  isAccountLocked,
  recordFailedAttempt,
} from "@/lib/auth/account-lockout";
import { safeAuthCallbackUrl } from "@/lib/auth/redirect";
import { getCachedSessionVersion } from "@/lib/api/session-cache";

/**
 * Thrown when a sign-in attempt is rejected because the account is temporarily
 * locked. The `code` is surfaced to the client (via `signIn(..).code`) so the
 * login form can show a lockout message instead of the generic
 * "Invalid email or password".
 */
class AccountLockedError extends CredentialsSignin {
  code = "account_locked";
}

export class EmailNotVerifiedError extends CredentialsSignin {
  code = "email_not_verified";
}

const dummyPasswordHash = argon2.hash("memoria-invalid-user-password", {
  type: argon2.argon2id,
});

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/auth/login",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = String(credentials.email).trim().toLowerCase();
        const clientId =
          request.headers.get("x-memoria-client-ip") || "unknown";

        // Reject an active lockout before expensive password hashing
        if (await isAccountLocked(email, clientId)) {
          throw new AccountLockedError();
        }

        const delayMs = await getLoginDelay(email);
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || !user.passwordHash) {
          // Spend the same expensive verification work for unknown users so
          // account existence is not exposed through response timing.
          await argon2.verify(
            await dummyPasswordHash,
            credentials.password as string,
          );
          await recordFailedAttempt(email, clientId);
          return null;
        }

        // Verify password first before evaluating any email verification state
        const isValidPassword = await argon2.verify(
          user.passwordHash,
          credentials.password as string,
        );

        if (!isValidPassword) {
          await recordFailedAttempt(email, clientId);
          return null;
        }

        if (process.env.NODE_ENV === "production" && !user.emailVerified) {
          throw new EmailNotVerifiedError();
        }

        // Login successful, clear attempts
        await clearFailedAttempts(email, clientId);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async redirect({ url, baseUrl }) {
      return safeAuthCallbackUrl(url, baseUrl);
    },
    async jwt({ token, user }) {
      if (user) {
        token["id"] = user.id as string;
      }

      const userId = token["id"];
      if (typeof userId !== "string") return null;

      const currentSessionVersion = await getCachedSessionVersion(userId);
      if (currentSessionVersion === null) return null;

      if (user) {
        token["sessionVersion"] = currentSessionVersion;
      } else if (token["sessionVersion"] !== currentSessionVersion) {
        return null;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
