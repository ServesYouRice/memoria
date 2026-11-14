/**
 * Forgot Password API Route
 *
 * Handles password reset requests by generating a secure token and sending
 * a password reset email. Implements security best practices including:
 * - Email enumeration prevention (always returns success)
 * - Secure token generation using nanoid
 * - Token expiration (1 hour by default)
 * - Durable delivery: the mail is an outbox job (`email.password-reset`)
 *
 * @module app/api/v1/auth/forgot-password
 *
 * ## Endpoint
 * POST /api/v1/auth/forgot-password
 *
 * ## Request Body
 * ```json
 * {
 *   "email": "user@example.com"
 * }
 * ```
 *
 * ## Response
 * ```json
 * {
 *   "message": "If an account exists with this email, you will receive password reset instructions."
 * }
 * ```
 *
 * ## Security Notes
 * - Always returns success to prevent email enumeration attacks
 * - Only sends email if user actually exists in database
 * - Token is 32 characters of secure random data
 * - The outbox worker retries provider failures; they never affect the
 *   response
 *
 * @see {@link createPasswordResetEmailHandler} for delivery
 */

import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/agents/crypto";
import { PASSWORD_RESET_EMAIL_JOB } from "@/lib/email/outbox-handler";
import { errorResponse } from "@/lib/errors";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import { z } from "zod";
import { nanoid } from "nanoid";
import { createHash } from "crypto";

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const TOKEN_EXPIRY_HOURS = 1; // Token expires in 1 hour

// Both branches answer no sooner than this after the request starts, so the
// token write for an existing account cannot be told apart by timing.
const FORGOT_PASSWORD_RESPONSE_FLOOR_MS = 500;

const ACCEPTED_MESSAGE =
  "If an account exists with this email, you will receive password reset instructions.";

async function acceptedRequest(startedAt: number): Promise<NextResponse> {
  const remainingMs =
    startedAt + FORGOT_PASSWORD_RESPONSE_FLOOR_MS - Date.now();
  if (remainingMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, remainingMs));
  }
  return NextResponse.json({ message: ACCEPTED_MESSAGE });
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await request.json();
    const { email } = forgotPasswordSchema.parse(body);

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Always return success to prevent email enumeration attacks
    // But only send email if user exists
    if (user) {
      // Generate secure token
      const token = nanoid(32); // 32-character random token
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + TOKEN_EXPIRY_HOURS);

      // The token and its mail job commit together (IMP-152): the outbox
      // worker sends it, retries a provider outage, and the request never
      // waits on a provider round trip that would reveal the account by
      // timing. The raw token is kept encrypted for the job only.
      await prisma.$transaction(async (tx) => {
        const reset = await tx.passwordResetToken.create({
          data: {
            token: tokenHash,
            email: email.toLowerCase(),
            expiresAt,
            deliverySecret: encryptSecret(token),
          },
        });
        await enqueueOutboxJob(tx, {
          type: PASSWORD_RESET_EMAIL_JOB,
          payload: { resetTokenId: reset.id },
          dedupeKey: `${PASSWORD_RESET_EMAIL_JOB}:${reset.id}`,
        });
      });
    }

    // Always return success (security best practice)
    return acceptedRequest(startedAt);
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
