import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/v1/canvases
 *
 * Fetch all canvases for the authenticated user
 * Per ADR-0001: API Versioning & Error Contract (RFC 7807)
 */
export async function GET() {
  try {
    // Authentication check
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        {
          type: 'https://canvascollect.com/errors/unauthorized',
          title: 'Unauthorized',
          status: 401,
          detail: 'You must be logged in to access this resource',
        },
        { status: 401 }
      );
    }

    // Fetch all canvases for the user
    const canvases = await prisma.canvas.findMany({
      where: {
        userId: session.user.id,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return NextResponse.json(canvases);
  } catch (error) {
    console.error('Error fetching canvases:', error);
    return NextResponse.json(
      {
        type: 'https://canvascollect.com/errors/internal-error',
        title: 'Internal Server Error',
        status: 500,
        detail: 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}
