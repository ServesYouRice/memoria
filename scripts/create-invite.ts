import { parseArgs } from "node:util";
import { z } from "zod";
import { env } from "../src/lib/env";
import { prisma } from "../src/lib/db";
import { ApiError } from "../src/lib/errors";
import {
  INVITE_MAX_TTL_DAYS,
  INVITE_TTL_DAYS,
  createRegistrationInvite,
  isInviteMailConfigured,
  registrationInviteUrl,
} from "../src/lib/auth/registration-invites";

// IMP-153 (DEC-024): the owner invites someone from the command line.
//   pnpm invite person@example.com [--days 7] [--no-email]
// Prints the sign-up link once; only its hash is stored. With a mail
// provider set, the outbox worker also emails it.

const usage =
  "Usage: pnpm invite <email> [--days 1-30] [--no-email]\n" +
  "Prints a single-use sign-up link for that email address.";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    days: { type: "string" },
    "no-email": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.warn(usage);
  process.exit(0);
}

const input = z
  .object({
    email: z.string().trim().email().max(254),
    days: z.coerce
      .number()
      .int()
      .min(1)
      .max(INVITE_MAX_TTL_DAYS)
      .default(INVITE_TTL_DAYS),
  })
  .safeParse({ email: positionals[0], days: values.days });

if (!input.success || positionals.length !== 1) {
  console.error(usage);
  process.exit(1);
}

try {
  const sendEmail = !values["no-email"] && isInviteMailConfigured();
  const { invite, token, emailQueued } = await createRegistrationInvite(
    prisma,
    { email: input.data.email, ttlDays: input.data.days, sendEmail },
  );
  if (env.REGISTRATION_MODE !== "invite") {
    console.warn(
      `Note: REGISTRATION_MODE is "${env.REGISTRATION_MODE}", not "invite".`,
    );
  }
  console.warn(
    `Invite for ${invite.email}, valid until ${invite.expiresAt.toISOString()}.` +
      (emailQueued ? " An email is queued." : " No email was sent."),
  );
  console.warn("Sign-up link (shown once):");
  console.log(registrationInviteUrl(env.AUTH_URL, token, invite.email));
} catch (error) {
  const reason =
    error instanceof ApiError
      ? (error.detail ?? error.title)
      : error instanceof Error
        ? error.message
        : String(error);
  console.error(`Could not create the invite: ${reason}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
