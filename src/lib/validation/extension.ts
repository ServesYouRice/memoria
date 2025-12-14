import { z } from 'zod';

export const clipSchema = z.object({
    url: z.string().url(),
    title: z.string().optional(),
    selection: z.string().optional(),
    canvasId: z.string().uuid().optional(),
});

export const webhookSchema = z.object({
    type: z.enum(['note', 'bookmark']),
    content: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    canvasId: z.string().uuid().optional(),
});
