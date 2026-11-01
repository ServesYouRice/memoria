/**
 * Embed-scoped upload URLs
 *
 * Image items store relative `/api/v1/uploads/<id>` URLs, which the upload
 * route serves to signed-in users on private canvases. An embed viewer has no
 * session, so the embed page tags those URLs with its own token and the upload
 * route accepts it for assets of the embedded canvas only.
 *
 * A query parameter on the existing route (rather than a path under
 * `/embed/<token>/`) keeps API rate limiting and authorization in one place.
 * The token is already in the embed page URL, and the page sends
 * `Referrer-Policy: no-referrer`, so this adds no new leak path to
 * third parties; same-origin image requests never reach them.
 */

import { ItemType, type CanvasItem } from "@/types/canvas";

export const EMBED_ASSET_TOKEN_PARAM = "embed";

const UPLOAD_URL = /^\/api\/v1\/uploads\/[A-Za-z0-9_-]+$/;

export function withEmbedAssetTokens(
  items: CanvasItem[],
  token: string,
): CanvasItem[] {
  return items.map((item) => {
    const content = item.content as { url?: unknown } | null;
    if (
      item.type !== ItemType.IMAGE ||
      typeof content?.url !== "string" ||
      !UPLOAD_URL.test(content.url)
    ) {
      return item;
    }
    return {
      ...item,
      content: {
        ...content,
        url: `${content.url}?${EMBED_ASSET_TOKEN_PARAM}=${encodeURIComponent(token)}`,
      },
    } as CanvasItem;
  });
}
