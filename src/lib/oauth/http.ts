import { NextResponse } from "next/server";
import { OAuthError } from "@/lib/oauth/service";
import { logger } from "@/lib/logger";

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

/** Metadata documents are public and read cross-origin by browser-based clients. */
export function oauthMetadataResponse(body: unknown) {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export function oauthJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function oauthErrorResponse(error: unknown) {
  if (error instanceof OAuthError) {
    return NextResponse.json(
      { error: error.error, error_description: error.description },
      {
        status: error.status,
        headers: {
          ...NO_STORE,
          ...(error.status === 401
            ? { "WWW-Authenticate": 'Basic realm="memoria"' }
            : {}),
        },
      },
    );
  }

  logger.error({ error }, "OAuth endpoint failed");
  return NextResponse.json(
    { error: "server_error", error_description: "Unexpected server error." },
    { status: 500, headers: NO_STORE },
  );
}

/** Token and revocation endpoints take form bodies (RFC 6749); JSON is tolerated. */
export async function readOAuthForm(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  let values: Record<string, string> = {};

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      values = Object.fromEntries(
        Object.entries(body).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    }
  } else {
    const text = await request.text();
    values = Object.fromEntries(new URLSearchParams(text));
  }

  return values;
}

/** client_secret_basic credentials win over form fields when both are sent. */
export function readClientCredentials(
  request: Request,
  form: Record<string, string>,
) {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Basic ")) {
    const decoded = Buffer.from(
      authorization.slice("Basic ".length),
      "base64",
    ).toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator > 0) {
      return {
        clientId: decodeURIComponent(decoded.slice(0, separator)),
        clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
      };
    }
  }

  return {
    clientId: form.client_id || "",
    clientSecret: form.client_secret || null,
  };
}
