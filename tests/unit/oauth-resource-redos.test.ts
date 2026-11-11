import { describe, expect, it } from "vitest";
import { getMcpResourceUrl, isMcpResource } from "@/lib/oauth/config";
import { readOAuthForm } from "@/lib/oauth/http";
import { OAuthError } from "@/lib/oauth/service";

const legacy = (resource: string) =>
  resource.replace(/\/+$/, "") === getMcpResourceUrl();

describe("isMcpResource", () => {
  it("runs in linear time on a long run of slashes", () => {
    const hostile = "/".repeat(100_000) + "x";
    const started = performance.now();
    expect(isMcpResource(hostile)).toBe(false);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("matches the previous behaviour on normal resources", () => {
    const base = getMcpResourceUrl();
    for (const value of [
      base,
      `${base}/`,
      `${base}//////`,
      `${base}x`,
      `${base}/x`,
      "https://other.example/api/agent/v1/mcp",
      "",
      "/",
      "///",
    ]) {
      expect(isMcpResource(value)).toBe(legacy(value));
    }
  });

  it("rejects an over-length resource", () => {
    expect(isMcpResource(getMcpResourceUrl() + "/".repeat(5000))).toBe(false);
  });
});

describe("readOAuthForm", () => {
  it("rejects a body over the cap with an OAuth invalid_request error", async () => {
    const request = new Request("http://localhost/api/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&resource=${"%2F".repeat(100_000)}`,
    });
    await expect(readOAuthForm(request)).rejects.toMatchObject({
      error: "invalid_request",
    });
    await expect(
      readOAuthForm(
        new Request("http://localhost/api/oauth/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resource: "/".repeat(100_000) }),
        }),
      ),
    ).rejects.toBeInstanceOf(OAuthError);
  });

  it("still reads a normal form", async () => {
    const form = await readOAuthForm(
      new Request("http://localhost/api/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=refresh_token&refresh_token=abc",
      }),
    );
    expect(form).toEqual({ grant_type: "refresh_token", refresh_token: "abc" });
  });
});
