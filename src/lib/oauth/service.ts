import { AgentProfileStatus, type Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  AGENT_CAPABILITY_RUNGS,
  DEFAULT_AGENT_ENABLED_RUNGS,
} from "@/lib/agents/constants";
import {
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_AUTHORIZATION_CODE_TTL_SECONDS,
  OAUTH_CONSENT_TICKET_TTL_SECONDS,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS,
  OAUTH_SCOPE,
  getMcpResourceUrl,
  isMcpResource,
} from "@/lib/oauth/config";
import {
  generateAccessToken,
  generateAuthorizationCode,
  generateClientId,
  generateClientSecret,
  generateRefreshToken,
  hashOAuthSecret,
  safeEqual,
  signConsentTicket,
  verifyConsentTicket,
  verifyPkceS256,
} from "@/lib/oauth/crypto";

/** RFC 6749 §5.2 / RFC 7591 §3.2.2 error, rendered as `{ error, error_description }`. */
export class OAuthError extends Error {
  constructor(
    public readonly error: string,
    public readonly description: string,
    public readonly status = 400,
  ) {
    super(description);
    this.name = "OAuthError";
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MAX_REDIRECT_URIS = 10;

function parseRedirectUri(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.hash || url.username || url.password) {
    return null;
  }

  if (url.protocol === "https:") {
    return url;
  }

  // Locally running agents (OpenClaw, Hermes, CLIs) receive codes on loopback.
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) {
    return url;
  }

  return null;
}

/** Exact match, except loopback ports may vary per RFC 8252 §7.3. */
export function redirectUriMatches(registered: string[], candidate: string) {
  const requested = parseRedirectUri(candidate);
  if (!requested) {
    return false;
  }

  return registered.some((value) => {
    if (value === candidate) {
      return true;
    }

    const allowed = parseRedirectUri(value);
    return Boolean(
      allowed &&
      allowed.protocol === "http:" &&
      LOOPBACK_HOSTS.has(allowed.hostname) &&
      allowed.hostname === requested.hostname &&
      allowed.pathname === requested.pathname &&
      allowed.search === requested.search,
    );
  });
}

const clientRegistrationSchema = z.object({
  redirect_uris: z.array(z.string().max(2048)).min(1).max(MAX_REDIRECT_URIS),
  client_name: z.string().trim().max(100).optional(),
  client_uri: z.string().max(2048).optional(),
  token_endpoint_auth_method: z
    .enum(["none", "client_secret_post", "client_secret_basic"])
    .default("none"),
  grant_types: z.array(z.string().max(64)).max(10).optional(),
  response_types: z.array(z.string().max(64)).max(10).optional(),
});

export async function registerClient(input: unknown) {
  const parsed = clientRegistrationSchema.safeParse(input);
  if (!parsed.success) {
    throw new OAuthError(
      "invalid_client_metadata",
      "redirect_uris must list 1-10 URLs and client metadata must be valid.",
    );
  }

  const data = parsed.data;
  if (data.redirect_uris.some((uri) => !parseRedirectUri(uri))) {
    throw new OAuthError(
      "invalid_redirect_uri",
      "Redirect URIs must use https, or http on a loopback address.",
    );
  }

  const unsupportedGrant = data.grant_types?.find(
    (grant) => grant !== "authorization_code" && grant !== "refresh_token",
  );
  if (unsupportedGrant) {
    throw new OAuthError(
      "invalid_client_metadata",
      `Unsupported grant type: ${unsupportedGrant}.`,
    );
  }

  if (data.response_types?.some((type) => type !== "code")) {
    throw new OAuthError(
      "invalid_client_metadata",
      "Only the code response type is supported.",
    );
  }

  const clientUri =
    data.client_uri && parseRedirectUri(data.client_uri)
      ? data.client_uri
      : null;
  const clientSecret =
    data.token_endpoint_auth_method === "none" ? null : generateClientSecret();

  const client = await prisma.oAuthClient.create({
    data: {
      clientId: generateClientId(),
      clientName: data.client_name || "MCP client",
      redirectUris: data.redirect_uris,
      clientUri,
      tokenEndpointAuthMethod: data.token_endpoint_auth_method,
      clientSecretHash: clientSecret ? hashOAuthSecret(clientSecret) : null,
    },
  });

  return {
    client_id: client.clientId,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    ...(clientSecret
      ? { client_secret: clientSecret, client_secret_expires_at: 0 }
      : {}),
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    ...(client.clientUri ? { client_uri: client.clientUri } : {}),
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: OAUTH_SCOPE,
  };
}

export interface AuthorizationRequest {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  resource: string;
}

/**
 * Errors that must not be sent to the redirect URI (unknown client or
 * redirect) are thrown as OAuthError; the caller renders them to the user.
 * Other problems return a redirect carrying the error to the client.
 */
export async function validateAuthorizationRequest(
  params: Record<string, string | undefined>,
): Promise<
  | { ok: true; request: AuthorizationRequest }
  | { ok: false; redirectTo: string }
> {
  const clientId = params.client_id || "";
  const redirectUri = params.redirect_uri || "";
  const client = clientId
    ? await prisma.oAuthClient.findUnique({ where: { clientId } })
    : null;

  if (!client) {
    throw new OAuthError("invalid_client", "This app is not registered.");
  }

  if (!redirectUriMatches(client.redirectUris, redirectUri)) {
    throw new OAuthError(
      "invalid_request",
      "The return address does not match what this app registered.",
    );
  }

  const state = params.state ?? null;
  const fail = (error: string, description: string) => ({
    ok: false as const,
    redirectTo: buildRedirect(redirectUri, {
      error,
      error_description: description,
      state,
    }),
  });

  if (params.response_type !== "code") {
    return fail("unsupported_response_type", "Only code is supported.");
  }

  if (
    !params.code_challenge ||
    !/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge) ||
    params.code_challenge_method !== "S256"
  ) {
    return fail("invalid_request", "PKCE with S256 is required.");
  }

  const resource = params.resource || getMcpResourceUrl();
  if (!isMcpResource(resource)) {
    return fail("invalid_target", "Unknown resource.");
  }

  return {
    ok: true,
    request: {
      clientId: client.clientId,
      clientName: client.clientName,
      redirectUri,
      codeChallenge: params.code_challenge,
      state,
      resource: getMcpResourceUrl(),
    },
  };
}

export function buildRedirect(
  redirectUri: string,
  params: Record<string, string | null | undefined>,
) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export function createConsentTicket(
  request: AuthorizationRequest,
  userId: string,
) {
  return signConsentTicket({
    ...request,
    userId,
    exp: Math.floor(Date.now() / 1000) + OAUTH_CONSENT_TICKET_TTL_SECONDS,
  });
}

const consentTicketSchema = z.object({
  clientId: z.string(),
  clientName: z.string(),
  redirectUri: z.string(),
  codeChallenge: z.string(),
  state: z.string().nullable(),
  resource: z.string(),
  userId: z.string(),
  exp: z.number(),
});

function readConsentTicket(ticket: string, userId: string) {
  const parsed = consentTicketSchema.safeParse(verifyConsentTicket(ticket));
  if (
    !parsed.success ||
    parsed.data.userId !== userId ||
    parsed.data.exp < Math.floor(Date.now() / 1000)
  ) {
    throw new OAuthError(
      "invalid_request",
      "This approval screen expired. Start connecting again from the app.",
    );
  }
  return parsed.data;
}

export async function decideConsent(input: {
  ticket: string;
  userId: string;
  approve: boolean;
  canvasIds: string[];
  allowDirectWrites: boolean;
}) {
  const request = readConsentTicket(input.ticket, input.userId);

  if (!input.approve) {
    return buildRedirect(request.redirectUri, {
      error: "access_denied",
      error_description: "The user declined access.",
      state: request.state,
    });
  }

  const ownedCanvases = await prisma.canvas.findMany({
    where: {
      userId: input.userId,
      id: { in: input.canvasIds },
    },
    select: { id: true },
  });

  if (ownedCanvases.length === 0) {
    throw new OAuthError(
      "invalid_request",
      "Choose at least one board this app may use.",
    );
  }

  const enabledRungs = input.allowDirectWrites
    ? [
        ...DEFAULT_AGENT_ENABLED_RUNGS,
        AGENT_CAPABILITY_RUNGS.WRITE_SINGLE,
        AGENT_CAPABILITY_RUNGS.WRITE_GROUP,
      ]
    : [...DEFAULT_AGENT_ENABLED_RUNGS];
  const code = generateAuthorizationCode();

  await prisma.$transaction(async (tx) => {
    const agentProfile = await tx.agentProfile.create({
      data: {
        userId: input.userId,
        name: `${request.clientName.slice(0, 80)} (connected app)`,
        status: AgentProfileStatus.ACTIVE,
        maxCapabilityRung: Math.max(...enabledRungs),
        enabledRungs,
        allowedCanvasIds: ownedCanvases.map((canvas) => canvas.id),
      },
      select: { id: true },
    });

    await tx.oAuthAuthorizationCode.create({
      data: {
        codeHash: hashOAuthSecret(code),
        clientId: request.clientId,
        userId: input.userId,
        agentProfileId: agentProfile.id,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        scope: OAUTH_SCOPE,
        resource: request.resource,
        expiresAt: new Date(
          Date.now() + OAUTH_AUTHORIZATION_CODE_TTL_SECONDS * 1000,
        ),
      },
    });
  });

  return buildRedirect(request.redirectUri, { code, state: request.state });
}

export async function authenticateClient(
  clientId: string,
  clientSecret: string | null,
) {
  const client = clientId
    ? await prisma.oAuthClient.findUnique({ where: { clientId } })
    : null;

  if (!client) {
    throw new OAuthError("invalid_client", "Unknown client.", 401);
  }

  if (client.clientSecretHash) {
    if (
      !clientSecret ||
      !safeEqual(hashOAuthSecret(clientSecret), client.clientSecretHash)
    ) {
      throw new OAuthError(
        "invalid_client",
        "Client authentication failed.",
        401,
      );
    }
  }

  return client;
}

async function issueTokens(
  tx: Pick<Prisma.TransactionClient, "oAuthToken">,
  grant: {
    clientId: string;
    userId: string;
    agentProfileId: string;
    resource: string;
  },
) {
  const accessToken = generateAccessToken();
  const refreshToken = generateRefreshToken();
  const now = Date.now();

  await tx.oAuthToken.create({
    data: {
      accessTokenHash: hashOAuthSecret(accessToken),
      refreshTokenHash: hashOAuthSecret(refreshToken),
      clientId: grant.clientId,
      userId: grant.userId,
      agentProfileId: grant.agentProfileId,
      scope: OAUTH_SCOPE,
      resource: grant.resource,
      accessExpiresAt: new Date(now + OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000),
      refreshExpiresAt: new Date(now + OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000),
    },
  });

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: OAUTH_SCOPE,
  };
}

export async function exchangeAuthorizationCode(input: {
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}) {
  const now = new Date();
  const record = await prisma.oAuthAuthorizationCode.findUnique({
    where: { codeHash: hashOAuthSecret(input.code) },
    include: { agentProfile: { select: { status: true } } },
  });

  if (!record || record.consumedAt || record.expiresAt <= now) {
    throw new OAuthError("invalid_grant", "The code is invalid or used.");
  }

  // Burn the code before checking it, outside any transaction, so a failed
  // attempt (wrong verifier, client or redirect) also uses it up for good.
  const claimed = await prisma.oAuthAuthorizationCode.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (claimed.count !== 1) {
    throw new OAuthError("invalid_grant", "The code is invalid or used.");
  }

  if (
    record.clientId !== input.clientId ||
    record.redirectUri !== input.redirectUri ||
    !verifyPkceS256(input.codeVerifier, record.codeChallenge)
  ) {
    throw new OAuthError("invalid_grant", "The code does not match.");
  }

  if (record.agentProfile.status !== AgentProfileStatus.ACTIVE) {
    throw new OAuthError("invalid_grant", "Access was turned off.");
  }

  return issueTokens(prisma, record);
}

export async function refreshAccessToken(input: {
  clientId: string;
  refreshToken: string;
}) {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const record = await tx.oAuthToken.findUnique({
      where: { refreshTokenHash: hashOAuthSecret(input.refreshToken) },
      include: { agentProfile: { select: { status: true } } },
    });

    if (
      !record ||
      record.revokedAt ||
      record.refreshExpiresAt <= now ||
      record.clientId !== input.clientId ||
      record.agentProfile.status !== AgentProfileStatus.ACTIVE
    ) {
      throw new OAuthError("invalid_grant", "The refresh token is invalid.");
    }

    // Rotation: the old pair stops working the moment a new one is issued.
    const revoked = await tx.oAuthToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: now },
    });
    if (revoked.count !== 1) {
      throw new OAuthError("invalid_grant", "The refresh token is invalid.");
    }

    return issueTokens(tx, record);
  });
}

export async function revokeToken(input: { clientId: string; token: string }) {
  const tokenHash = hashOAuthSecret(input.token);
  await prisma.oAuthToken.updateMany({
    where: {
      clientId: input.clientId,
      revokedAt: null,
      OR: [{ accessTokenHash: tokenHash }, { refreshTokenHash: tokenHash }],
    },
    data: { revokedAt: new Date() },
  });
}

const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

/** Returns the grant behind a live access token, or null. */
export async function resolveAccessToken(accessToken: string) {
  const now = new Date();
  const record = await prisma.oAuthToken.findUnique({
    where: { accessTokenHash: hashOAuthSecret(accessToken) },
    include: {
      agentProfile: {
        select: {
          id: true,
          userId: true,
          name: true,
          status: true,
          maxCapabilityRung: true,
          enabledRungs: true,
          allowedCanvasIds: true,
          defaultModelCredentialId: true,
        },
      },
    },
  });

  if (
    !record ||
    record.revokedAt ||
    record.accessExpiresAt <= now ||
    !isMcpResource(record.resource) ||
    record.agentProfile.status !== AgentProfileStatus.ACTIVE ||
    record.agentProfile.userId !== record.userId
  ) {
    return null;
  }

  if (
    !record.lastUsedAt ||
    now.getTime() - record.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS
  ) {
    await prisma.oAuthToken.update({
      where: { id: record.id },
      data: { lastUsedAt: now },
    });
  }

  return record;
}
