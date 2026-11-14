import { randomBytes } from "crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { encryptSecret } from "@/lib/agents/crypto";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import { getEmailConfig } from "@/lib/email";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { hashRegistrationInvite } from "./registration";

/**
 * IMP-153 (DEC-024): with `REGISTRATION_MODE=invite`, the owner of this
 * Memoria issues sign-up invites from Settings or `pnpm invite`.
 */

/** How long an invite link works unless the owner picks otherwise. */
export const INVITE_TTL_DAYS = 7;
export const INVITE_MAX_TTL_DAYS = 30;
export const REGISTRATION_INVITE_EMAIL_JOB = "email.registration-invite";

type Db = PrismaClient | Prisma.TransactionClient;

export type RegistrationInviteStatus = "pending" | "used" | "expired";

export interface RegistrationInviteSummary {
  id: string;
  email: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  status: RegistrationInviteStatus;
}

/**
 * The owner is the first account on this Memoria: the one `/setup` created.
 * There is no admin role; every later account is an ordinary person.
 */
export async function getInstanceOwnerId(
  db: Pick<PrismaClient, "user">,
): Promise<string | null> {
  const owner = await db.user.findFirst({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return owner?.id ?? null;
}

export async function isInstanceOwner(
  db: Pick<PrismaClient, "user">,
  userId: string,
): Promise<boolean> {
  return (await getInstanceOwnerId(db)) === userId;
}

/**
 * Rejects anyone but the owner. A 404, not a 403, so other accounts do not
 * learn that invite management exists.
 */
export async function requireInstanceOwner(
  db: Pick<PrismaClient, "user">,
  userId: string,
): Promise<void> {
  if (!(await isInstanceOwner(db, userId))) throw new NotFoundError();
}

/** Mail goes out only when a real provider is set; `console` only logs. */
export function isInviteMailConfigured(): boolean {
  return getEmailConfig().provider !== "console";
}

export function registrationInviteUrl(
  baseUrl: string,
  token: string,
  email: string,
): string {
  const url = new URL("/auth/register", baseUrl);
  url.searchParams.set("inviteToken", token);
  url.searchParams.set("email", email);
  return url.toString();
}

export function inviteStatus(
  invite: { usedAt: Date | null; expiresAt: Date },
  now = new Date(),
): RegistrationInviteStatus {
  if (invite.usedAt) return "used";
  return invite.expiresAt > now ? "pending" : "expired";
}

/**
 * Creates an invite and returns its token. Only the token's hash is stored;
 * with `sendEmail`, an encrypted copy rides along for the queued email.
 * A new invite replaces any unused one for the same email.
 */
export async function createRegistrationInvite(
  prisma: PrismaClient,
  input: {
    email: string;
    ttlDays?: number;
    sendEmail: boolean;
    now?: Date;
  },
): Promise<{
  invite: RegistrationInviteSummary;
  token: string;
  emailQueued: boolean;
}> {
  const email = input.email.trim().toLowerCase();
  const now = input.now ?? new Date();
  const ttlDays = input.ttlDays ?? INVITE_TTL_DAYS;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

  const invite = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError("Someone already signs in with this email.");
    }
    await tx.registrationInvite.deleteMany({ where: { email, usedAt: null } });
    const created = await tx.registrationInvite.create({
      data: {
        email,
        tokenHash: hashRegistrationInvite(token),
        expiresAt,
        deliverySecret: input.sendEmail ? encryptSecret(token) : null,
      },
      select: {
        id: true,
        email: true,
        createdAt: true,
        expiresAt: true,
        usedAt: true,
      },
    });
    if (input.sendEmail) {
      await enqueueOutboxJob(tx, {
        type: REGISTRATION_INVITE_EMAIL_JOB,
        payload: { inviteId: created.id },
        dedupeKey: `registration-invite:${created.id}`,
      });
    }
    return created;
  });

  return {
    invite: { ...invite, status: inviteStatus(invite, now) },
    token,
    emailQueued: input.sendEmail,
  };
}

export async function listRegistrationInvites(
  db: Db,
  now = new Date(),
): Promise<RegistrationInviteSummary[]> {
  const invites = await db.registrationInvite.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      email: true,
      createdAt: true,
      expiresAt: true,
      usedAt: true,
    },
  });
  return invites.map((invite) => ({
    ...invite,
    status: inviteStatus(invite, now),
  }));
}

/**
 * Takes back an invite nobody has used yet. The row goes, so the link stops
 * working and the queued email finds nothing to send.
 */
export async function revokeRegistrationInvite(
  db: Db,
  id: string,
): Promise<void> {
  const result = await db.registrationInvite.deleteMany({
    where: { id, usedAt: null },
  });
  if (result.count !== 1) throw new NotFoundError("Invite not found");
}
