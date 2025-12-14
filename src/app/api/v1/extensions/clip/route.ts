import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withValidation } from '@/lib/api/route-handler';
import { clipSchema } from '@/lib/validation/extension';
import { ItemType } from '@/types/canvas';
import { authenticateApiKey } from '@/lib/api/api-key-auth';

export const POST = withValidation(clipSchema, async ({ url, title, selection, canvasId }, req) => {
    const user = await authenticateApiKey(req);
    if (!user) {
        return NextResponse.json({ error: 'Invalid API Key' }, { status: 401 });
    }

    let targetCanvasId = canvasId;

    if (!targetCanvasId) {
        // Find "Inbox" or "Unsorted" or first canvas
        const inbox = await prisma.canvas.findFirst({
            where: { userId: user.id, name: 'Inbox' }
        });

        if (inbox) {
            targetCanvasId = inbox.id;
        } else {
            // Find first
            const first = await prisma.canvas.findFirst({
                where: { userId: user.id },
                orderBy: { createdAt: 'asc' }
            });
            if (first) {
                targetCanvasId = first.id;
            } else {
                // Create Inbox
                const newInbox = await prisma.canvas.create({
                    data: {
                        userId: user.id,
                        name: 'Inbox'
                    }
                });
                targetCanvasId = newInbox.id;
            }
        }
    }

    // Verify canvas ownership if ID provided
    if (canvasId) {
        const canvas = await prisma.canvas.findUnique({ where: { id: canvasId } });
        if (!canvas || canvas.userId !== user.id) {
            return NextResponse.json({ error: 'Canvas not found or unauthorized' }, { status: 404 });
        }
    }

    // Create Item
    // Note: We random position avoid stacking if possible but random is fine for MVC
    const item = await prisma.canvasItem.create({
        data: {
            canvasId: targetCanvasId,
            type: ItemType.BOOKMARK,
            positionX: Math.random() * 400,
            positionY: Math.random() * 400,
            width: 300,
            height: 100,
            content: {
                url,
                title: title || url,
                description: selection
            },
            createdById: user.id
        }
    });

    return NextResponse.json({ success: true, item });
});
