import { z } from 'zod';

export const unfurlSchema = z.object({
    url: z.string().url().min(1),
});
