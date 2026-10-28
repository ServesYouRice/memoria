import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import {
  hashOAuthSecret,
  signConsentTicket,
  verifyConsentTicket,
  verifyPkceS256,
} from "@/lib/oauth/crypto";
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  getMcpResourceUrl,
  getProtectedResourceMetadataUrl,
  isMcpResource,
} from "@/lib/oauth/config";
import { buildRedirect, redirectUriMatches } from "@/lib/oauth/service";

describe("PKCE", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  it("accepts the matching S256 verifier", () => {
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });

  it("rejects a wrong or malformed verifier", () => {
    expect(verifyPkceS256(`${verifier.slice(0, -1)}x`, challenge)).toBe(false);
    expect(verifyPkceS256("short", challenge)).toBe(false);
    expect(verifyPkceS256(`${verifier} `, challenge)).toBe(false);
  });
});

describe("consent tickets", () => {
  it("round-trips a signed payload", () => {
    const ticket = signConsentTicket({ clientId: "c1", userId: "u1" });
    expect(verifyConsentTicket(ticket)).toEqual({
      clientId: "c1",
      userId: "u1",
    });
  });

  it("rejects a ticket whose payload was edited", () => {
    const ticket = signConsentTicket({ userId: "u1" });
    const [, signature] = ticket.split(".");
    const forged = `${Buffer.from(JSON.stringify({ userId: "attacker" })).toString("base64url")}.${signature}`;
    expect(verifyConsentTicket(forged)).toBeNull();
    expect(verifyConsentTicket("garbage")).toBeNull();
    expect(verifyConsentTicket(`${ticket}.extra`)).toBeNull();
  });
});

describe("redirect URI matching", () => {
  it("requires an exact match for https redirects", () => {
    const registered = ["https://claude.ai/api/mcp/auth_callback"];
    expect(
      redirectUriMatches(registered, "https://claude.ai/api/mcp/auth_callback"),
    ).toBe(true);
    expect(
      redirectUriMatches(registered, "https://claude.ai/api/mcp/other"),
    ).toBe(false);
    expect(
      redirectUriMatches(
        registered,
        "https://evil.example/api/mcp/auth_callback",
      ),
    ).toBe(false);
  });

  it("lets loopback redirects change port only", () => {
    const registered = ["http://127.0.0.1:33418/callback"];
    expect(
      redirectUriMatches(registered, "http://127.0.0.1:50211/callback"),
    ).toBe(true);
    expect(redirectUriMatches(registered, "http://127.0.0.1:50211/other")).toBe(
      false,
    );
    expect(
      redirectUriMatches(registered, "http://localhost:50211/callback"),
    ).toBe(false);
  });

  it("never accepts plain http on a public host or URLs with fragments", () => {
    expect(
      redirectUriMatches(["http://example.com/cb"], "http://example.com/cb"),
    ).toBe(false);
    expect(
      redirectUriMatches(["https://a.example/cb#x"], "https://a.example/cb#x"),
    ).toBe(false);
  });

  it("adds parameters without dropping existing ones", () => {
    expect(
      buildRedirect("https://a.example/cb?keep=1", {
        code: "abc",
        state: null,
      }),
    ).toBe("https://a.example/cb?keep=1&code=abc");
  });
});

describe("OAuth metadata", () => {
  it("advertises PKCE-only authorization code flow on the app origin", () => {
    const metadata = buildAuthorizationServerMetadata();
    expect(metadata.issuer).toBe("http://localhost:3000");
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata.grant_types_supported).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
    expect(metadata.registration_endpoint).toBe(
      "http://localhost:3000/api/oauth/register",
    );
  });

  it("points the MCP resource at this authorization server", () => {
    expect(buildProtectedResourceMetadata()).toMatchObject({
      resource: "http://localhost:3000/api/agent/v1/mcp",
      authorization_servers: ["http://localhost:3000"],
    });
    expect(getProtectedResourceMetadataUrl()).toBe(
      "http://localhost:3000/.well-known/oauth-protected-resource/api/agent/v1/mcp",
    );
    expect(isMcpResource(`${getMcpResourceUrl()}/`)).toBe(true);
    expect(isMcpResource("https://other.example/api/agent/v1/mcp")).toBe(false);
  });

  it("hashes secrets deterministically without storing them", () => {
    expect(hashOAuthSecret("moa_x")).toBe(hashOAuthSecret("moa_x"));
    expect(hashOAuthSecret("moa_x")).not.toContain("moa_x");
  });
});
