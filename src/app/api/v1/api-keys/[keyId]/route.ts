import { type NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/api/auth';
import { withApiHandler } from '@/lib/api/route-handler';
import { notFoundError, forbiddenError } from '@/lib/errors';

interface RouteContext {
  params: { keyId: string };
}

export const DELETE = withApiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  const { userId } = await requireAuth();
  const { keyId } = params;

  const apiKey = await prisma.apiKey.findUnique({
    where: { id: keyId },
  });

  if (!apiKey) {
    throw notFoundError('ApiKey', keyId);
  }

  if (apiKey.userId !== userId) {
    throw forbiddenError();
  }

  if (!apiKey.revokedAt) {
    await prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
  }

  return NextResponse.json({ success: true });
});
