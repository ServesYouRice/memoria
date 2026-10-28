import { buildProtectedResourceMetadata } from "@/lib/oauth/config";
import { oauthMetadataResponse } from "@/lib/oauth/http";

export const dynamic = "force-dynamic";

/** Path-suffixed RFC 9728 location that MCP clients probe first. */
export function GET() {
  return oauthMetadataResponse(buildProtectedResourceMetadata());
}
