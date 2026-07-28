/**
 * Send Email Verification API
 * POST /api/v1/auth/send-verification
 *
 * Sends a verification email to the user
 */

import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse } from "@/lib/errors";
import { nanoid } from "nanoid";
import { createHash } from "crypto";
import { z } from "zod";
import { encryptSecret } from "@/lib/agents/crypto";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";

const TOKEN_EXPIRY_HOURS = 24; // Token expires in 24 hours
const resendSchema = z.object({ email: z.string().email() });
const GENERIC_RESPONSE = {
  message:
    "If an unverified account exists for that email, a verification message has been sent.",
};

export async function POST(request: NextRequest) {
  try {
    const { email } = resendSchema.parse(await request.json());

    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!user || user.emailVerified) {
      return NextResponse.json(GENERIC_RESPONSE, { status: 202 });
    }

    // Generate secure token
    const token = nanoid(32);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + TOKEN_EXPIRY_HOURS);

    await prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.updateMany({
        where: { email: user.email, usedAt: null },
        data: { usedAt: new Date() },
      });
      const verification = await tx.emailVerificationToken.create({
        data: {
          token: createHash("sha256").update(token).digest("hex"),
          email: user.email,
          expiresAt,
          deliverySecret: encryptSecret(token),
        },
      });
      await enqueueOutboxJob(tx, {
        type: "email.verification",
        payload: { verificationId: verification.id },
        dedupeKey: `email-verification:${verification.id}`,
      });
    });

    return NextResponse.json(GENERIC_RESPONSE, { status: 202 });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
