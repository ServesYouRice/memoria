import { NextResponse } from "next/server";
import { fetchLinkPage } from "@/lib/services/link-page";
import { getCachedUnfurl, setCachedUnfurl } from "@/lib/cache/unfurl-cache";
import { logger } from "@/lib/logger";
import { withAuthValidation } from "@/lib/api/route-handler";
import { unfurlSchema } from "@/lib/validation/unfurl";
import { ApiError } from "@/lib/errors";

export const POST = withAuthValidation(unfurlSchema, async ({ url }) => {
  if (process.env.FEATURE_BOOKMARK_UNFURLING === "false") {
    throw new ApiError(
      403,
      "https://memoria.local/errors/feature-disabled",
      "Feature Disabled",
      "Bookmark unfurling is disabled by administrator policy.",
    );
  }

  // Check cache first (ADR-0011)
  const cachedMetadata = await getCachedUnfurl(url);
  if (cachedMetadata) {
    logger.info({ url }, "Cache hit for unfurl");
    return NextResponse.json(cachedMetadata);
  }

  // Fetch with SSRF protection and extract metadata (shared with link
  // enrichment, IMP-064)
  const page = await fetchLinkPage(url);
  if (!page.ok) {
    // The site's own status is reported as upstreamStatus behind a 502; a
    // failure of ours keeps its status unless it is not an error status.
    const upstream = page.upstreamStatus !== undefined;
    const ownStatus =
      Number.isInteger(page.status) && page.status >= 400 && page.status <= 599;
    throw new ApiError(
      upstream || !ownStatus ? 502 : page.status,
      "https://memoria.local/errors/unfurl",
      "Unfurl Failed",
      page.error,
      upstream ? { upstreamStatus: page.upstreamStatus } : undefined,
    );
  }
  const cleanedMetadata = page.metadata;

  // Add unfurl timestamp
  const result = {
    ...cleanedMetadata,
    unfurledAt: new Date().toISOString(),
  };

  // Store in cache for future requests
  await setCachedUnfurl(url, result);

  return NextResponse.json(result);
});
