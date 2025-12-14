import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/db';
import * as argon2 from 'argon2';
import { getRedisClient } from '@/lib/cache/redis-client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('auth');

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_SECONDS = 15 * 60; // 15 minutes

async function checkAccountLockout(email: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  try {
    const attempts = await redis.get(`auth:attempts:${email}`);
    return !!attempts && parseInt(attempts) >= MAX_LOGIN_ATTEMPTS;
  } catch (error) {
    logger.warn({ error }, 'Redis error checking lockout');
    return false;
  }
}

async function recordFailedAttempt(email: string) {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    // Increment attempts
    const attempts = await redis.incr(`auth:attempts:${email}`);
    // Set expiry if new key (or refresh it)
    if (attempts === 1) {
      await redis.expire(`auth:attempts:${email}`, LOCKOUT_DURATION_SECONDS);
    }
  } catch (error) {
    logger.warn({ error }, 'Redis error recording failed attempt');
  }
}

async function clearLoginAttempts(email: string) {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.del(`auth:attempts:${email}`);
  } catch (error) {
    logger.warn({ error }, 'Redis error clearing failed attempts');
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/auth/login',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email as string;

        // Check for lockout
        const isLocked = await checkAccountLockout(email);
        if (isLocked) {
          throw new Error('Account locked due to too many failed attempts. Try again in 15 minutes.');
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
          credentials.password as string
        );

        if (!isValidPassword) {
          await recordFailedAttempt(email);
          return null;
        }

        // Login successful, clear attempts
        await clearLoginAttempts(email);

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
        token['id'] = user.id as string;
        token['issuedAt'] = Date.now();
      }

      // Token Rotation Check (15 minutes)
      // If token is older than 15 minutes, we could force a DB check or rotation
      // For now, we just ensure the session is valid
      if (token['issuedAt'] && typeof token['issuedAt'] === 'number') {
        const tokenAge = Date.now() - token['issuedAt'];
        if (tokenAge > 15 * 60 * 1000) {
          // Optimization: Here we could fetch user from DB to ensure they aren't banned/deleted
          // But since 'jwt' runs on every request in middleware (sometimes), be careful with DB calls
          // We'll leave this as a placeholder for explicit rotation logic if needed.

          // Rotate the token timestamp to extend the session
          token['issuedAt'] = Date.now();
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
});
