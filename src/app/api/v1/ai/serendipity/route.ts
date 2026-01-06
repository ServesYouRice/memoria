import { NextResponse } from 'next/server';
import { withAuthValidation } from '@/lib/api/route-handler';
import { serendipitySchema } from '@/lib/validation/ai';
import { findSerendipitousItems } from '@/lib/ai/serendipity-service';

export const POST = withAuthValidation(serendipitySchema, async ({ canvasId, keywords }, _req, session) => {
    const results = await findSerendipitousItems(
        session.user.id,
        canvasId,
        keywords || [],
        session.user.email || undefined
    );

    return NextResponse.json({ results });
});
