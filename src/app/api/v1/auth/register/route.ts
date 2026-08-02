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
import { validatePasswordStrength } from "@/lib/validation/password";
import {
  Problems,
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

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(10, "Password must be at least 10 characters"),
  name: z.string().min(1, "Name is required").max(100),
  inviteToken: z.string().min(16).max(256).optional(),
});

export const POST = withApiHandler(async (request: NextRequest) => {
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

  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existingUser) {
    return problemToResponse(
      Problems.Conflict("A user with this email already exists"),
    );
  }

  // Hash password with Argon2id
  const passwordHash = await hashPassword(password);

  const verificationToken = nanoid(32);
  const expiresAt = new Date(
    Date.now() + VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000,
  );

  // Every normal account receives the same baseline resources used by the
  // bootstrap path, so integration ingest always has a scoped Inbox.
  const user = await prisma.$transaction(async (tx) => {
    await consumeRegistrationAdmission(tx, admission);
    const createdUser = await tx.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        name,
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });
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

  return NextResponse.json(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
      verificationRequired: true,
      verificationEmailQueued: true,
    },
    { status: 201 },
  );
});
