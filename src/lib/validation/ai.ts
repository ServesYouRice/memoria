import { z } from 'zod';

export const tagSchema = z.object({
    content: z.string().min(1).max(5000),
});

export const chatSchema = z.object({
    message: z.string().min(1),
    context: z.string().optional(),
    persona: z.enum(['creative', 'socratic', 'architect'])
});

export const serendipitySchema = z.object({
    canvasId: z.string().cuid(),
    keywords: z.array(z.string()).optional()
});

export const generateSchema = z.object({
    prompt: z.string().min(1).max(5000),
    system: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
});

export const summarizeSchema = z.object({
    canvasId: z.string().cuid(),
});
