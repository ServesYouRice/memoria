import { env } from "@/lib/env";

/** The only scope Memoria grants; capability rungs refine it per consent. */
export const OAUTH_SCOPE = "memoria";

export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const OAUTH_AUTHORIZATION_CODE_TTL_SECONDS = 10 * 60;
export const OAUTH_CONSENT_TICKET_TTL_SECONDS = 15 * 60;

export const MCP_RESOURCE_PATH = "/api/agent/v1/mcp";

/** Public origin that issues tokens; AUTH_URL is the operator's public URL. */
export function getOAuthIssuer() {
  return new URL(env.AUTH_URL).origin;
}

export function getMcpResourceUrl() {
  return `${getOAuthIssuer()}${MCP_RESOURCE_PATH}`;
}

export function getProtectedResourceMetadataUrl() {
  return `${getOAuthIssuer()}/.well-known/oauth-protected-resource${MCP_RESOURCE_PATH}`;
}

export function buildAuthorizationServerMetadata() {
  const issuer = getOAuthIssuer();

  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    scopes_supported: [OAUTH_SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ],
    revocation_endpoint_auth_methods_supported: [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ],
    code_challenge_methods_supported: ["S256"],
  };
}

export function buildProtectedResourceMetadata() {
  return {
    resource: getMcpResourceUrl(),
    authorization_servers: [getOAuthIssuer()],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Memoria",
  };
}

/** Resource indicators (RFC 8707) are ordinary absolute URIs. */
export const MAX_RESOURCE_LENGTH = 2048;

/**
 * Accepts the canonical resource with or without trailing slashes. Trims
 * with a linear scan: an unanchored `/\/+$/` is quadratic on a long run of
 * slashes followed by another character, and this value comes straight from
 * an anonymous token request.
 */
export function isMcpResource(resource: string) {
  if (resource.length > MAX_RESOURCE_LENGTH) return false;
  let end = resource.length;
  while (end > 0 && resource.charCodeAt(end - 1) === 47) end -= 1;
  return resource.slice(0, end) === getMcpResourceUrl();
}
