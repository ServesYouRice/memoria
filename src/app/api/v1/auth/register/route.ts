/**
 * User Registration API Route
 * POST /api/v1/auth/register
 *
 * Following ADR-0001: RFC 7807 error responses
 * Following ADR-0008: Argon2id password hashing, zxcvbn >= 3 validation
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createCredentialAccount } from "@/lib/auth/credentials";
import {
  PASSWORD_MAX_LENGTH,
  validatePasswordStrength,
} from "@/lib/validation/password";
import {
  problemToResponse,
  createValidationProblem,
  type ValidationErrorDetail,
} from "@/lib/errors";
import { withApiHandler } from "@/lib/api/route-handler";
import { nanoid } from "nanoid";
import { createHash } from "crypto";
import { env } from "@/lib/env";
import { encryptSecret } from "@/lib/agents/crypto";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import {
  consumeRegistrationAdmission,
  prepareRegistrationAdmission,
} from "@/lib/auth/registration";

const VERIFICATION_EXPIRY_HOURS = 24;

/**
 * Every accepted registration answers no sooner than this after the request
 * started. A new account runs a multi-write transaction that an existing email
 * skips; the floor keeps that difference out of the response time. It sits
 * well above the Argon2id hash plus the account transaction.
 */
const REGISTRATION_RESPONSE_FLOOR_MS = 500;

/**
 * The one success response for both a new account and an email that is
 * already registered: same status, same fields, no account id. Telling the
 * two apart would let anyone probe which emails have accounts.
 */
async function acceptedRegistration(
  startedAt: number,
  email: string,
  name: string,
): Promise<NextResponse> {
  const remainingMs = startedAt + REGISTRATION_RESPONSE_FLOOR_MS - Date.now();
  if (remainingMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, remainingMs));
  }
  return NextResponse.json(
    {
      email,
      name,
      verificationRequired: true,
      verificationEmailQueued: true,
      message:
        "If this email can be registered, a verification message is on its way.",
    },
    { status: 202 },
  );
}

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(
      PASSWORD_MAX_LENGTH,
      `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
    ),
  name: z.string().min(1, "Name is required").max(100),
  inviteToken: z.string().min(16).max(256).optional(),
});

export const POST = withApiHandler(async (request: NextRequest) => {
  const startedAt = Date.now();
  // Parse and validate request body
  const body = await request.json();
  const parseResult = registerSchema.safeParse(body);

  if (!parseResult.success) {
    const errors: ValidationErrorDetail[] = parseResult.error.issues.map(
      (err) => ({
        field: err.path.join("."),
        message: err.message,
        code: err.code,
      }),
    );
    return problemToResponse(createValidationProblem(errors));
  }

  const { email, password, name, inviteToken } = parseResult.data;
  const normalizedEmail = email.toLowerCase();

  // Enforce the operator's admission policy before password analysis, hashing,
  // or account provisioning. Invite failures deliberately share one response.
  const admission = await prepareRegistrationAdmission(prisma, {
    mode: env.REGISTRATION_MODE,
    email: normalizedEmail,
    inviteToken,
  });

  // Check password strength with zxcvbn
  const passwordStrength = await validatePasswordStrength(password, [
    email,
    name,
  ]);

  if (!passwordStrength.isValid) {
    const errors: ValidationErrorDetail[] = [
      {
        field: "password",
        message: passwordStrength.feedback.warning || "Password is too weak",
        code: "PASSWORD_TOO_WEAK",
      },
    ];

    if (passwordStrength.feedback.suggestions.length > 0) {
      errors.push(
        ...passwordStrength.feedback.suggestions.map((suggestion) => ({
          field: "password",
          message: suggestion,
          code: "PASSWORD_SUGGESTION",
        })),
      );
    }

    return problemToResponse(
      createValidationProblem(
        errors,
        `Password strength score ${passwordStrength.score}/4 is below required minimum of 3`,
      ),
    );
  }

  // Hash password with Argon2id before checking existing user to maintain constant-time path
  const passwordHash = await hashPassword(password);

  // An existing email gets the same accepted response as a new account.
  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });

  if (existingUser) {
    return acceptedRegistration(startedAt, normalizedEmail, name);
  }

  const verificationToken = nanoid(32);
  const expiresAt = new Date(
    Date.now() + VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000,
  );

  // Every normal account receives the same baseline resources used by the
  // bootstrap path, so integration ingest always has a scoped Inbox.
  try {
    const user = await prisma.$transaction(async (tx) => {
      await consumeRegistrationAdmission(tx, admission);
      const createdUser = await tx.user.create({
        data: {
          email: normalizedEmail,
          name,
        },
        select: { id: true, email: true },
      });
      await createCredentialAccount(tx, createdUser.id, passwordHash);
      const workspace = await tx.workspace.create({
        data: { name: "Personal", userId: createdUser.id },
        select: { id: true },
      });
      await tx.canvas.create({
        data: {
          name: "Inbox",
          userId: createdUser.id,
          workspaceId: workspace.id,
        },
      });
      const verification = await tx.emailVerificationToken.create({
        data: {
          token: createHash("sha256").update(verificationToken).digest("hex"),
          email: createdUser.email,
          expiresAt,
          deliverySecret: encryptSecret(verificationToken),
        },
      });
      await enqueueOutboxJob(tx, {
        type: "email.verification",
        payload: { verificationId: verification.id },
        dedupeKey: `email-verification:${verification.id}`,
      });
      return createdUser;
    });

    return acceptedRegistration(startedAt, user.email, name);
  } catch (error: any) {
    if (
      error?.code === "P2002" &&
      Array.isArray(error?.meta?.target) &&
      error.meta.target.includes("email")
    ) {
      return acceptedRegistration(startedAt, normalizedEmail, name);
    }
    throw error;
  }
});
