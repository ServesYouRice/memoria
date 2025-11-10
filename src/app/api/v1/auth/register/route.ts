/**
 * User Registration API Route
 * POST /api/v1/auth/register
 *
 * Following ADR-0001: RFC 7807 error responses
 * Following ADR-0008: Argon2id password hashing, zxcvbn >= 3 validation
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { validatePasswordStrength } from '@/lib/validation/password';
import {
  Problems,
  problemToResponse,
  createValidationProblem,
  type ValidationErrorDetail,
} from '@/lib/errors';

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(10, 'Password must be at least 10 characters'),
  name: z.string().min(1, 'Name is required').max(100),
});

export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json();
    const parseResult = registerSchema.safeParse(body);

    if (!parseResult.success) {
      const errors: ValidationErrorDetail[] = parseResult.error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
        code: err.code,
      }));
      return problemToResponse(createValidationProblem(errors));
    }

    const { email, password, name } = parseResult.data;

    // Check password strength with zxcvbn
    const passwordStrength = validatePasswordStrength(password, [email, name]);

    if (!passwordStrength.isValid) {
      const errors: ValidationErrorDetail[] = [
        {
          field: 'password',
          message: passwordStrength.feedback.warning || 'Password is too weak',
          code: 'PASSWORD_TOO_WEAK',
        },
      ];

      if (passwordStrength.feedback.suggestions.length > 0) {
        errors.push(
          ...passwordStrength.feedback.suggestions.map((suggestion) => ({
            field: 'password',
            message: suggestion,
            code: 'PASSWORD_SUGGESTION',
          }))
        );
      }

      return problemToResponse(
        createValidationProblem(
          errors,
          `Password strength score ${passwordStrength.score}/4 is below required minimum of 3`
        )
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      return problemToResponse(Problems.Conflict('A user with this email already exists'));
    }

    // Hash password with Argon2id
    const passwordHash = await hashPassword(password);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
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

    return NextResponse.json(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Registration error:', error);
    return problemToResponse(Problems.InternalServerError());
  }
}
