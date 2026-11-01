import type { Prisma } from "@/generated/prisma/client";

/**
 * Better Auth keeps the email/password hash on an Account row whose provider
 * is `credential` and whose `accountId` equals the user id. Every Memoria
 * write path (registration, bootstrap, reset, change, deletion) goes through
 * these helpers so the row shape stays the one Better Auth signs in against.
 */
export const CREDENTIAL_PROVIDER_ID = "credential";

type AccountClient = Pick<Prisma.TransactionClient, "account">;

export function createCredentialAccount(
  db: AccountClient,
  userId: string,
  passwordHash: string,
) {
  return db.account.create({
    data: {
      userId,
      accountId: userId,
      providerId: CREDENTIAL_PROVIDER_ID,
      password: passwordHash,
    },
    select: { id: true },
  });
}

/** The stored Argon2 hash, or null when the account has no password. */
export async function getCredentialPasswordHash(
  db: AccountClient,
  userId: string,
): Promise<string | null> {
  const account = await db.account.findUnique({
    where: {
      providerId_accountId: {
        providerId: CREDENTIAL_PROVIDER_ID,
        accountId: userId,
      },
    },
    select: { userId: true, password: true },
  });
  if (!account || account.userId !== userId) return null;
  return account.password ?? null;
}

/** Replace the password hash; resolves to the number of rows updated. */
export async function setCredentialPassword(
  db: AccountClient,
  userId: string,
  passwordHash: string,
): Promise<number> {
  const result = await db.account.updateMany({
    where: {
      userId,
      accountId: userId,
      providerId: CREDENTIAL_PROVIDER_ID,
    },
    data: { password: passwordHash },
  });
  return result.count;
}
