import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '@/lib/ai/service';
import { auth } from '@/lib/auth';

export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session) {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        const body = await req.json();
        const { prompt, system, temperature } = body;

        if (!prompt) {
            return new NextResponse('Missing prompt', { status: 400 });
        }

        const content = await generateText({ prompt, system, temperature });

        return NextResponse.json({ content });
    } catch (error) {
        console.error('AI Generation API Error:', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
