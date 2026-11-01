/**
 * Per-embed framing selection for the request proxy.
 *
 * Every response denies framing by default. Only `/embed/<token>` for a token
 * that is correctly signed, unexpired, and unrevoked may be framed, and only by
 * that embed's allowed origins.
 */

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { normalizeEmbedOrigins } from "./origins";
import { resolveEmbedToken } from "./service";

const logger = createLogger("embed-framing");
const EMBED_PATH = /^\/embed\/([^/]+)\/?$/;

export function embedTokenFromPath(pathname: string): string | null {
  return EMBED_PATH.exec(pathname)?.[1] ?? null;
}

/**
 * Returns the `frame-ancestors` origins for an embed path, or null when the
 * response must keep the global frame denial. Fails closed on any error.
 */
export async function resolveEmbedFramingOrigins(
  pathname: string,
): Promise<string[] | null> {
  const token = embedTokenFromPath(pathname);
  if (!token) return null;

  try {
    const embed = await resolveEmbedToken(prisma, token);
    if (!embed) return null;
    // Re-validate stored values so a bad row can never widen the policy.
    return normalizeEmbedOrigins(embed.allowedOrigins);
  } catch (error) {
    logger.error({ error }, "Embed framing lookup failed; denying framing");
    return null;
  }
}
