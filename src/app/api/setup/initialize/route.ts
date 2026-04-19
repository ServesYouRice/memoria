import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { isBootstrapAvailable } from "@/lib/bootstrap";
import { hashPassword } from "@/lib/auth/password";
import { validatePasswordStrength } from "@/lib/validation/password";
import {
  BadRequestError,
  ConflictError,
  UnauthorizedError,
  errorResponse,
} from "@/lib/errors";

const setupSchema = z.object({
  token: z.string().optional(),
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(10).max(128),
});

function isLocalDevelopmentRequest(request: NextRequest) {
  const { hostname } = request.nextUrl;
  return (
    process.env.NODE_ENV !== "production" &&
    (hostname === "localhost" || hostname === "127.0.0.1")
  );
}

export async function POST(request: NextRequest) {
  try {
    const payload = setupSchema.parse(await request.json());

    if (!(await isBootstrapAvailable())) {
      throw new ConflictError("Bootstrap is no longer available.");
    }

    const providedToken = payload.token?.trim();
    const expectedToken = env.APP_BOOTSTRAP_TOKEN?.trim();
    if (
      !isLocalDevelopmentRequest(request) &&
      (!providedToken || providedToken !== expectedToken)
    ) {
      throw new UnauthorizedError("Invalid bootstrap token.");
    }

    const normalizedEmail = payload.email.trim().toLowerCase();
    const passwordStrength = await validatePasswordStrength(payload.password, [
      normalizedEmail,
      payload.name,
    ]);

    if (!passwordStrength.isValid) {
      const suggestions = passwordStrength.feedback.suggestions.join(" ");
      throw new BadRequestError(
        [
          passwordStrength.feedback.warning || "Password is too weak.",
          suggestions,
        ]
          .filter(Boolean)
          .join(" ")
          .trim(),
      );
    }

    const passwordHash = await hashPassword(payload.password);

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          name: payload.name.trim(),
          passwordHash,
          emailVerified: new Date(),
        },
        select: {
          id: true,
          email: true,
          name: true,
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: "Personal",
          userId: user.id,
        },
        select: {
          id: true,
          name: true,
        },
      });

      const canvas = await tx.canvas.create({
        data: {
          name: "Inbox",
          userId: user.id,
          workspaceId: workspace.id,
        },
        select: {
          id: true,
          name: true,
        },
      });

      return { user, workspace, canvas };
    });

    return NextResponse.json(
      {
        message: "Bootstrap complete. You can now sign in.",
        ...created,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
