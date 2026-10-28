import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as OAuthServiceModule from "@/lib/oauth/service";
import { NextRequest } from "next/server";

const serviceMocks = vi.hoisted(() => ({
  registerClient: vi.fn(),
  authenticateClient: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
  refreshAccessToken: vi.fn(),
  revokeToken: vi.fn(),
  decideConsent: vi.fn(),
}));
const sessionMocks = vi.hoisted(() => ({ getCachedSession: vi.fn() }));

vi.mock("@/lib/oauth/service", async (importOriginal) => {
  const actual = await importOriginal<typeof OAuthServiceModule>();
  return { ...actual, ...serviceMocks };
});
vi.mock("@/lib/api/session-cache", () => ({
  getCachedSession: sessionMocks.getCachedSession,
  runWithSessionCache: (fn: () => unknown) => fn(),
}));

import { OAuthError } from "@/lib/oauth/service";
import { POST as registerPost } from "@/app/api/oauth/register/route";
import { POST as tokenPost } from "@/app/api/oauth/token/route";
import { POST as revokePost } from "@/app/api/oauth/revoke/route";
import { POST as authorizePost } from "@/app/api/oauth/authorize/route";
import { GET as authServerMetadata } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as resourceMetadata } from "@/app/.well-known/oauth-protected-resource/route";
import { GET as resourceMetadataForMcp } from "@/app/.well-known/oauth-protected-resource/api/agent/v1/mcp/route";

function formRequest(
  url: string,
  fields: Record<string, string>,
  headers = {},
) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  });
}

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const client = { clientId: "mcp_client", clientSecretHash: null };

beforeEach(() => {
  vi.clearAllMocks();
  serviceMocks.authenticateClient.mockResolvedValue(client);
});

describe("OAuth discovery documents", () => {
  it("publishes authorization server and resource metadata", async () => {
    const server = await authServerMetadata().json();
    expect(server.token_endpoint).toBe("http://localhost:3000/api/oauth/token");

    for (const handler of [resourceMetadata, resourceMetadataForMcp]) {
      const response = handler();
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect((await response.json()).resource).toBe(
        "http://localhost:3000/api/agent/v1/mcp",
      );
    }
  });
});

describe("POST /api/oauth/register", () => {
  it("returns the registered client with 201 and no caching", async () => {
    serviceMocks.registerClient.mockResolvedValue({ client_id: "mcp_new" });

    const response = await registerPost(
      jsonRequest("http://localhost/api/oauth/register", {
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ client_id: "mcp_new" });
  });

  it("renders metadata errors in RFC 7591 shape", async () => {
    serviceMocks.registerClient.mockRejectedValue(
      new OAuthError("invalid_redirect_uri", "Bad redirect."),
    );

    const response = await registerPost(
      jsonRequest("http://localhost/api/oauth/register", {}),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_redirect_uri",
      error_description: "Bad redirect.",
    });
  });

  it("hides unexpected failures behind server_error", async () => {
    serviceMocks.registerClient.mockRejectedValue(new Error("db down"));
    const response = await registerPost(
      jsonRequest("http://localhost/api/oauth/register", {}),
    );
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("server_error");
  });
});

describe("POST /api/oauth/token", () => {
  it("exchanges an authorization code", async () => {
    serviceMocks.exchangeAuthorizationCode.mockResolvedValue({
      access_token: "moa_x",
    });

    const response = await tokenPost(
      formRequest("http://localhost/api/oauth/token", {
        grant_type: "authorization_code",
        client_id: "mcp_client",
        code: "moc_code",
        redirect_uri: "https://claude.ai/cb",
        code_verifier: "v".repeat(43),
        resource: "http://localhost:3000/api/agent/v1/mcp",
      }),
    );

    expect(response.status).toBe(200);
    expect(serviceMocks.authenticateClient).toHaveBeenCalledWith(
      "mcp_client",
      null,
    );
    expect(serviceMocks.exchangeAuthorizationCode).toHaveBeenCalledWith({
      clientId: "mcp_client",
      code: "moc_code",
      redirectUri: "https://claude.ai/cb",
      codeVerifier: "v".repeat(43),
    });
  });

  it("reads client_secret_basic credentials and refreshes", async () => {
    serviceMocks.refreshAccessToken.mockResolvedValue({
      access_token: "moa_y",
    });
    const basic = Buffer.from("mcp_client:mcs_secret").toString("base64");

    const response = await tokenPost(
      formRequest(
        "http://localhost/api/oauth/token",
        { grant_type: "refresh_token", refresh_token: "mor_old" },
        { authorization: `Basic ${basic}` },
      ),
    );

    expect(response.status).toBe(200);
    expect(serviceMocks.authenticateClient).toHaveBeenCalledWith(
      "mcp_client",
      "mcs_secret",
    );
    expect(serviceMocks.refreshAccessToken).toHaveBeenCalledWith({
      clientId: "mcp_client",
      refreshToken: "mor_old",
    });
  });

  it.each([
    [{ grant_type: "password" }, "unsupported_grant_type"],
    [{ grant_type: "authorization_code", code: "x" }, "invalid_request"],
    [{ grant_type: "refresh_token" }, "invalid_request"],
    [
      {
        grant_type: "refresh_token",
        refresh_token: "mor_old",
        resource: "https://other.example/mcp",
      },
      "invalid_target",
    ],
  ])("rejects %o with %s", async (fields, error) => {
    const response = await tokenPost(
      formRequest("http://localhost/api/oauth/token", {
        client_id: "mcp_client",
        ...fields,
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(error);
  });

  it("answers failed client authentication with 401", async () => {
    serviceMocks.authenticateClient.mockRejectedValue(
      new OAuthError("invalid_client", "Client authentication failed.", 401),
    );
    const response = await tokenPost(
      formRequest("http://localhost/api/oauth/token", {
        grant_type: "refresh_token",
        refresh_token: "mor_old",
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
  });

  it("accepts JSON bodies as well as forms", async () => {
    serviceMocks.refreshAccessToken.mockResolvedValue({
      access_token: "moa_z",
    });
    const response = await tokenPost(
      jsonRequest("http://localhost/api/oauth/token", {
        grant_type: "refresh_token",
        refresh_token: "mor_old",
        client_id: "mcp_client",
      }),
    );
    expect(response.status).toBe(200);
  });
});

describe("POST /api/oauth/revoke", () => {
  it("revokes a token and always answers 200", async () => {
    const response = await revokePost(
      formRequest("http://localhost/api/oauth/revoke", {
        client_id: "mcp_client",
        token: "mor_old",
      }),
    );
    expect(response.status).toBe(200);
    expect(serviceMocks.revokeToken).toHaveBeenCalledWith({
      clientId: "mcp_client",
      token: "mor_old",
    });
  });

  it("does nothing without a token", async () => {
    const response = await revokePost(
      formRequest("http://localhost/api/oauth/revoke", {
        client_id: "mcp_client",
      }),
    );
    expect(response.status).toBe(200);
    expect(serviceMocks.revokeToken).not.toHaveBeenCalled();
  });
});

describe("POST /api/oauth/authorize", () => {
  it("requires a signed-in user", async () => {
    sessionMocks.getCachedSession.mockResolvedValue(null);
    const response = await authorizePost(
      jsonRequest("http://localhost/api/oauth/authorize", {
        ticket: "t",
        approve: true,
      }),
    );
    expect(response.status).toBe(401);
    expect(serviceMocks.decideConsent).not.toHaveBeenCalled();
  });

  it("returns where the browser should go next", async () => {
    sessionMocks.getCachedSession.mockResolvedValue({ user: { id: "u1" } });
    serviceMocks.decideConsent.mockResolvedValue("https://claude.ai/cb?code=x");

    const response = await authorizePost(
      jsonRequest("http://localhost/api/oauth/authorize", {
        ticket: "t",
        approve: true,
        canvasIds: ["c1"],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      redirectTo: "https://claude.ai/cb?code=x",
    });
    expect(serviceMocks.decideConsent).toHaveBeenCalledWith({
      ticket: "t",
      userId: "u1",
      approve: true,
      canvasIds: ["c1"],
      allowDirectWrites: false,
    });
  });

  it("shows consent problems to the user instead of redirecting", async () => {
    sessionMocks.getCachedSession.mockResolvedValue({ user: { id: "u1" } });
    serviceMocks.decideConsent.mockRejectedValue(
      new OAuthError("invalid_request", "This approval screen expired."),
    );

    const response = await authorizePost(
      jsonRequest("http://localhost/api/oauth/authorize", {
        ticket: "t",
        approve: true,
      }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error_description).toBe(
      "This approval screen expired.",
    );
  });
});
