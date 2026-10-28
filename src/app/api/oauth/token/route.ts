import { type NextRequest } from "next/server";
import {
  OAuthError,
  authenticateClient,
  exchangeAuthorizationCode,
  refreshAccessToken,
} from "@/lib/oauth/service";
import { isMcpResource } from "@/lib/oauth/config";
import {
  oauthErrorResponse,
  oauthJsonResponse,
  readClientCredentials,
  readOAuthForm,
} from "@/lib/oauth/http";

export async function POST(request: NextRequest) {
  try {
    const form = await readOAuthForm(request);
    const credentials = readClientCredentials(request, form);
    const client = await authenticateClient(
      credentials.clientId,
      credentials.clientSecret,
    );

    if (form.resource && !isMcpResource(form.resource)) {
      throw new OAuthError("invalid_target", "Unknown resource.");
    }

    switch (form.grant_type) {
      case "authorization_code":
        if (!form.code || !form.redirect_uri || !form.code_verifier) {
          throw new OAuthError(
            "invalid_request",
            "code, redirect_uri and code_verifier are required.",
          );
        }
        return oauthJsonResponse(
          await exchangeAuthorizationCode({
            clientId: client.clientId,
            code: form.code,
            redirectUri: form.redirect_uri,
            codeVerifier: form.code_verifier,
          }),
        );
      case "refresh_token":
        if (!form.refresh_token) {
          throw new OAuthError("invalid_request", "refresh_token is required.");
        }
        return oauthJsonResponse(
          await refreshAccessToken({
            clientId: client.clientId,
            refreshToken: form.refresh_token,
          }),
        );
      default:
        throw new OAuthError(
          "unsupported_grant_type",
          "Use authorization_code or refresh_token.",
        );
    }
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
