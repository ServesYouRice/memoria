import NextAuth, { CredentialsSignin } from "next-auth";
import type { NextAuthConfig } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import * as argon2 from "argon2";
import {
  clearFailedAttempts,
  getLockoutRemaining,
  isAccountLocked,
  recordFailedAttempt,
} from "@/lib/auth/account-lockout";

/**
 * Thrown when sign-in is blocked by account lockout. The `code` is surfaced
 * to the client in the signIn() response so the form can show the real
 * reason instead of "Invalid email or password".
 */
export class AccountLockedError extends CredentialsSignin {
  constructor(remainingMinutes: number) {
    super("Account locked due to too many failed attempts");
    this.code = `account_locked:${remainingMinutes}`;
  }
}

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
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = String(credentials.email).trim().toLowerCase();

        // Check for lockout
        const isLocked = await isAccountLocked(email);
        if (isLocked) {
          const remainingSeconds = await getLockoutRemaining(email);
          const remainingMinutes = Math.max(
            1,
            Math.ceil(remainingSeconds / 60),
          );
          throw new AccountLockedError(remainingMinutes);
        }

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || !user.passwordHash) {
          // Record failed attempt to prevent enumeration (attribute to email)
          await recordFailedAttempt(email);
          return null;
        }

        const isValidPassword = await argon2.verify(
          user.passwordHash,
          credentials.password as string,
        );

        if (!isValidPassword) {
          await recordFailedAttempt(email);
          return null;
        }

        // Login successful, clear attempts
        await clearFailedAttempts(email);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger: _trigger }) {
      if (user) {
        token["id"] = user.id as string;
        token["issuedAt"] = Date.now();
      }

      // Token Rotation Check (15 minutes)
      // If token is older than 15 minutes, we could force a DB check or rotation
      // For now, we just ensure the session is valid
      if (token["issuedAt"] && typeof token["issuedAt"] === "number") {
        const tokenAge = Date.now() - token["issuedAt"];
        if (tokenAge > 15 * 60 * 1000) {
          // Optimization: Here we could fetch user from DB to ensure they aren't banned/deleted
          // But since 'jwt' runs on every request in middleware (sometimes), be careful with DB calls
          // We'll leave this as a placeholder for explicit rotation logic if needed.

          // Rotate the token timestamp to extend the session
          token["issuedAt"] = Date.now();
        }
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
