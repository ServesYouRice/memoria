import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withValidation } from '@/lib/api/route-handler';
import { webhookSchema } from '@/lib/validation/extension';
import { ItemType } from '@/types/canvas';
import { authenticateApiKey } from '@/lib/api/api-key-auth';

export const POST = withValidation(webhookSchema, async ({ type, content, title, description, canvasId }, req) => {
    const user = await authenticateApiKey(req);
    if (!user) {
        return NextResponse.json({ error: 'Invalid API Key' }, { status: 401 });
    }

    // Determine Canvas
    let targetCanvasId = canvasId;
    if (!targetCanvasId) {
        // Default to Inbox or First
        const inbox = await prisma.canvas.findFirst({ where: { userId: user.id, name: 'Inbox' } });
        if (inbox) {
            targetCanvasId = inbox.id;
        } else {
            const first = await prisma.canvas.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
            targetCanvasId = first ? first.id : (await prisma.canvas.create({ data: { userId: user.id, name: 'Inbox' } })).id;
        }
    }

    // Verify ownership if ID provided
    if (canvasId) {
        const canvas = await prisma.canvas.findUnique({ where: { id: canvasId } });
        if (!canvas || canvas.userId !== user.id) {
            return NextResponse.json({ error: 'Canvas not found or unauthorized' }, { status: 404 });
        }
    }

    const itemType = type === 'note' ? ItemType.NOTE : ItemType.BOOKMARK;
    const itemContent = type === 'note'
        ? { text: content }
        : { url: content, title: title || content, description };

    const item = await prisma.canvasItem.create({
        data: {
            canvasId: targetCanvasId,
            type: itemType,
            positionX: Math.random() * 400,
            positionY: Math.random() * 400,
            width: 300,
            height: type === 'note' ? 200 : 100,
            content: itemContent,
            createdById: user.id
        }
    });

    return NextResponse.json({ success: true, item });
});
