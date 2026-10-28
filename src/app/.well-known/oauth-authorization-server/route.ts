import { buildAuthorizationServerMetadata } from "@/lib/oauth/config";
import { oauthMetadataResponse } from "@/lib/oauth/http";

export const dynamic = "force-dynamic";

/** RFC 8414 authorization server metadata for MCP clients. */
export function GET() {
  return oauthMetadataResponse(buildAuthorizationServerMetadata());
}
