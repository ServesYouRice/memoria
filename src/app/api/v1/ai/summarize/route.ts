import { NextResponse } from 'next/server';
import { summarizeCanvas } from '@/lib/ai/service';
import { prisma } from '@/lib/db';
import { withAuthValidation } from '@/lib/api/route-handler';
import { summarizeSchema } from '@/lib/validation/ai';

export const POST = withAuthValidation(summarizeSchema, async ({ canvasId }, _req, session) => {
    // Check permission
    const canvas = await prisma.canvas.findUnique({
        where: { id: canvasId },
        include: { items: true }
    });

    if (!canvas) {
        return NextResponse.json({ error: 'Canvas not found' }, { status: 404 });
    }

    // Basic permission check - owner or shared (simplified for now)
    if (canvas.userId !== session.user.id && !canvas.isPublic) {
        // TODO: Check permissions in CanvasShare
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const summary = await summarizeCanvas(canvas.items);

    return NextResponse.json({ summary });
});
