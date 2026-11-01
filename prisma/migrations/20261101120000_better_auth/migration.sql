-- IMP-041: move authentication from Auth.js (next-auth 5 beta) to Better Auth.
--
-- Data mapping:
--   * User."passwordHash" (Argon2id) moves verbatim to a Better Auth
--     `credential` Account row whose "accountId" is the user id. The hash is
--     not rewritten, so every existing password keeps working.
--   * User."emailVerified" was a nullable timestamp. Better Auth needs a
--     boolean; the timestamp is kept as "emailVerifiedAt".
--   * Auth.js OAuth Account columns are renamed to their Better Auth names and
--     the epoch-seconds "expires_at" becomes "accessTokenExpiresAt".
--   * Auth.js ran with JWT sessions, so the old Session table never held a
--     usable session. Its rows are removed and the table is reshaped for
--     Better Auth's server-side sessions. Browser JWT cookies stop being
--     accepted; people sign in once more with their current password.
--   * User."sessionVersion" is dropped: revocation now deletes Session rows.
--   * PasswordResetToken and EmailVerificationToken keep their hashed tokens
--     and remain the reset and verification authority.

-- User ----------------------------------------------------------------------
ALTER TABLE "User" RENAME COLUMN "emailVerified" TO "emailVerifiedAt";
ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User" SET "emailVerified" = true WHERE "emailVerifiedAt" IS NOT NULL;
ALTER TABLE "User" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Account -------------------------------------------------------------------
DROP INDEX "Account_provider_providerAccountId_key";
ALTER TABLE "Account" RENAME COLUMN "provider" TO "providerId";
ALTER TABLE "Account" RENAME COLUMN "providerAccountId" TO "accountId";
ALTER TABLE "Account" RENAME COLUMN "access_token" TO "accessToken";
ALTER TABLE "Account" RENAME COLUMN "refresh_token" TO "refreshToken";
ALTER TABLE "Account" RENAME COLUMN "id_token" TO "idToken";
ALTER TABLE "Account" ADD COLUMN "accessTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "Account" ADD COLUMN "refreshTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "Account" ADD COLUMN "password" TEXT;
ALTER TABLE "Account" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Account" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Account"
SET "accessTokenExpiresAt" = to_timestamp("expires_at")
WHERE "expires_at" IS NOT NULL;
ALTER TABLE "Account" DROP COLUMN "expires_at";
ALTER TABLE "Account" DROP COLUMN "type";
ALTER TABLE "Account" DROP COLUMN "token_type";
ALTER TABLE "Account" DROP COLUMN "session_state";
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

INSERT INTO "Account" ("id", "userId", "accountId", "providerId", "password", "createdAt", "updatedAt")
SELECT
  'cred_' || replace(gen_random_uuid()::text, '-', ''),
  u."id",
  u."id",
  'credential',
  u."passwordHash",
  u."createdAt",
  CURRENT_TIMESTAMP
FROM "User" u
WHERE u."passwordHash" IS NOT NULL
ON CONFLICT ("providerId", "accountId")
DO UPDATE SET "password" = EXCLUDED."password", "updatedAt" = CURRENT_TIMESTAMP;

-- Prisma owns @updatedAt; keep the column shape identical to a fresh table.
ALTER TABLE "Account" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "User" DROP COLUMN "passwordHash";
ALTER TABLE "User" DROP COLUMN "sessionVersion";

-- Session -------------------------------------------------------------------
DELETE FROM "Session";
DROP INDEX "Session_sessionToken_key";
DROP INDEX "Session_expires_idx";
ALTER TABLE "Session" RENAME COLUMN "sessionToken" TO "token";
ALTER TABLE "Session" RENAME COLUMN "expires" TO "expiresAt";
ALTER TABLE "Session" DROP COLUMN "deviceInfo";
ALTER TABLE "Session" DROP COLUMN "revokedAt";
ALTER TABLE "Session" ADD COLUMN "ipAddress" TEXT;
ALTER TABLE "Session" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "Session" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Session" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL;
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- Verification ----------------------------------------------------------------
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");
CREATE INDEX "Verification_expiresAt_idx" ON "Verification"("expiresAt");

-- TwoFactor -------------------------------------------------------------------
CREATE TABLE "TwoFactor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "TwoFactor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TwoFactor_userId_idx" ON "TwoFactor"("userId");
CREATE INDEX "TwoFactor_secret_idx" ON "TwoFactor"("secret");
ALTER TABLE "TwoFactor" ADD CONSTRAINT "TwoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Passkey ---------------------------------------------------------------------
CREATE TABLE "Passkey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "publicKey" TEXT NOT NULL,
    "credentialID" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "transports" TEXT,
    "aaguid" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Passkey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Passkey_credentialID_key" ON "Passkey"("credentialID");
CREATE INDEX "Passkey_userId_idx" ON "Passkey"("userId");
ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
