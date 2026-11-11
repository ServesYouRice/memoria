import { createHash, randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

import {
  createConsentTicket,
  decideConsent,
  exchangeAuthorizationCode,
  refreshAccessToken,
  registerClient,
  resolveAccessToken,
  validateAuthorizationRequest,
} from "@/lib/oauth/service";

afterAll(async () => {
  await prisma.$disconnect();
});

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

async function oauthGrant(userId?: string) {
  const user = userId
    ? { id: userId }
    : await prisma.user.create({
        data: { email: `reuse-${randomBytes(4).toString("hex")}@example.com` },
      });
  const inbox = await prisma.canvas.create({
    data: { name: "Inbox", userId: user.id },
  });
  const registration = await registerClient({
    client_name: "Claude",
    redirect_uris: [REDIRECT],
  });
  const verifier = randomBytes(32).toString("base64url");
  const validation = await validateAuthorizationRequest({
    response_type: "code",
    client_id: registration.client_id,
    redirect_uri: REDIRECT,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: "s",
    resource: "http://localhost:3000/api/agent/v1/mcp",
  });
  if (!validation.ok) throw new Error("authorization request rejected");
  const code = new URL(
    await decideConsent({
      ticket: createConsentTicket(validation.request, user.id),
      userId: user.id,
      approve: true,
      canvasIds: [inbox.id],
      allowDirectWrites: false,
    }),
  ).searchParams.get("code")!;
  const exchange = (clientId = registration.client_id) =>
    exchangeAuthorizationCode({
      clientId,
      code,
      redirectUri: REDIRECT,
      codeVerifier: verifier,
    });
  const tokens = await exchange();
  return { user, clientId: registration.client_id, tokens, exchange };
}

describe("refresh-token reuse (RFC 9700 4.14.2)", () => {
  it("revokes the whole family when a rotated refresh token is replayed", async () => {
    const { clientId, tokens } = await oauthGrant();
    const rotated = await refreshAccessToken({
      clientId,
      refreshToken: tokens.refresh_token,
    });
    expect(await resolveAccessToken(rotated.access_token)).not.toBeNull();

    await expect(
      refreshAccessToken({ clientId, refreshToken: tokens.refresh_token }),
    ).rejects.toMatchObject({ error: "invalid_grant" });

    expect(await resolveAccessToken(rotated.access_token)).toBeNull();
    await expect(
      refreshAccessToken({ clientId, refreshToken: rotated.refresh_token }),
    ).rejects.toMatchObject({ error: "invalid_grant" });
  });

  it("leaves other families of the same user alone", async () => {
    const first = await oauthGrant();
    const second = await oauthGrant(first.user.id);
    await refreshAccessToken({
      clientId: first.clientId,
      refreshToken: first.tokens.refresh_token,
    });
    await expect(
      refreshAccessToken({
        clientId: first.clientId,
        refreshToken: first.tokens.refresh_token,
      }),
    ).rejects.toMatchObject({ error: "invalid_grant" });
    expect(await resolveAccessToken(second.tokens.access_token)).not.toBeNull();
  });

  it("never leaves two live families after concurrent refreshes", async () => {
    const { clientId, tokens } = await oauthGrant();
    const results = await Promise.allSettled([
      refreshAccessToken({ clientId, refreshToken: tokens.refresh_token }),
      refreshAccessToken({ clientId, refreshToken: tokens.refresh_token }),
    ]);
    const live = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (await resolveAccessToken(result.value.access_token))
          live.push(result);
      }
    }
    expect(live.length).toBeLessThanOrEqual(1);
  });
});

describe("authorization-code reuse (RFC 6749 4.1.2)", () => {
  it("revokes the tokens issued from the code, refreshed ones included", async () => {
    const { clientId, tokens, exchange } = await oauthGrant();
    const rotated = await refreshAccessToken({
      clientId,
      refreshToken: tokens.refresh_token,
    });

    await expect(exchange()).rejects.toMatchObject({ error: "invalid_grant" });

    expect(await resolveAccessToken(tokens.access_token)).toBeNull();
    expect(await resolveAccessToken(rotated.access_token)).toBeNull();
    await expect(
      refreshAccessToken({ clientId, refreshToken: rotated.refresh_token }),
    ).rejects.toMatchObject({ error: "invalid_grant" });
  });

  it("does not revoke when another client presents the used code", async () => {
    const { tokens, exchange } = await oauthGrant();
    const other = await registerClient({
      client_name: "Other",
      redirect_uris: [REDIRECT],
    });

    await expect(exchange(other.client_id)).rejects.toMatchObject({
      error: "invalid_grant",
    });

    expect(await resolveAccessToken(tokens.access_token)).not.toBeNull();
  });
});
