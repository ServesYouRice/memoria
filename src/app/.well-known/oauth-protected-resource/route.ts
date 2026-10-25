import { buildProtectedResourceMetadata } from "@/lib/oauth/config";
import { oauthMetadataResponse } from "@/lib/oauth/http";

export const dynamic = "force-dynamic";

/** RFC 9728 protected resource metadata for the MCP endpoint. */
export function GET() {
  return oauthMetadataResponse(buildProtectedResourceMetadata());
}
