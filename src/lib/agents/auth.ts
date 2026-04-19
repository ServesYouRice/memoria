import { randomBytes } from "crypto";
import * as argon2 from "argon2";
import { type NextRequest } from "next/server";
import { AgentProfileStatus, IntegrationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCachedSession } from "@/lib/api/session-cache";
import {
  BadRequestError,
  ForbiddenError,
  UnauthorizedError,
} from "@/lib/errors";

const INTEGRATION_TOKEN_PREFIX = "mat_";
const PREFIX_LENGTH = 8;
const SUFFIX_LENGTH = 6;

type AgentProfileRecord = {
  id: string;
  userId: string;
  name: string;
  status: AgentProfileStatus;
  maxCapabilityRung: number;
  enabledRungs: number[];
  allowedCanvasIds: string[];
  defaultModelCredentialId: string | null;
};

export interface AgentRequestContext {
  actorType: "user" | "integration";
  userId: string;
  agentProfile: AgentProfileRecord | null;
  integrationAccountId: string | null;
}

function getRequestedAgentProfileId(request: NextRequest) {
  return (
    request.headers.get("x-agent-profile-id") ||
    request.nextUrl.searchParams.get("agentProfileId")
  );
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return request.headers.get("x-agent-token")?.trim() || null;
}

export async function generateIntegrationToken() {
  const token = `${INTEGRATION_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const hash = await argon2.hash(token, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  return {
    plaintextToken: token,
    hash,
    prefix: token.slice(0, PREFIX_LENGTH),
    suffix: token.slice(-SUFFIX_LENGTH),
  };
}

export async function getOwnedAgentProfile(
  userId: string,
  agentProfileId: string,
): Promise<AgentProfileRecord> {
  const agentProfile = await prisma.agentProfile.findFirst({
    where: {
      id: agentProfileId,
      userId,
    },
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
  });

  if (!agentProfile) {
    throw new ForbiddenError("Agent profile not found for this user.");
  }

  return agentProfile;
}

async function authenticateIntegrationToken(
  token: string,
): Promise<AgentRequestContext> {
  const prefix = token.slice(0, PREFIX_LENGTH);
  const suffix = token.slice(-SUFFIX_LENGTH);

  const integration = await prisma.integrationAccount.findFirst({
    where: {
      secretPrefix: prefix,
      secretSuffix: suffix,
      status: IntegrationStatus.ACTIVE,
      agentProfile: {
        status: AgentProfileStatus.ACTIVE,
      },
    },
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

  if (!integration) {
    throw new UnauthorizedError("Invalid integration token.");
  }

  const isValid = await argon2.verify(integration.encryptedSecretOrHash, token);
  if (!isValid) {
    throw new UnauthorizedError("Invalid integration token.");
  }

  await prisma.integrationAccount.update({
    where: { id: integration.id },
    data: { lastSeenAt: new Date() },
  });

  return {
    actorType: "integration",
    userId: integration.agentProfile.userId,
    agentProfile: integration.agentProfile,
    integrationAccountId: integration.id,
  };
}

export async function resolveAgentRequestContext(
  request: NextRequest,
  options?: {
    allowUserSession?: boolean;
    requireAgentProfile?: boolean;
  },
): Promise<AgentRequestContext> {
  const allowUserSession = options?.allowUserSession ?? true;
  const requireAgentProfile = options?.requireAgentProfile ?? false;

  const token = getBearerToken(request);
  if (token) {
    return authenticateIntegrationToken(token);
  }

  if (!allowUserSession) {
    throw new UnauthorizedError(
      "An integration token is required for this endpoint.",
    );
  }

  const session = await getCachedSession();
  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }

  const requestedAgentProfileId = getRequestedAgentProfileId(request);
  const agentProfile = requestedAgentProfileId
    ? await getOwnedAgentProfile(session.user.id, requestedAgentProfileId)
    : null;

  if (requireAgentProfile && !agentProfile) {
    throw new BadRequestError("agentProfileId is required for this endpoint.");
  }

  return {
    actorType: "user",
    userId: session.user.id,
    agentProfile,
    integrationAccountId: null,
  };
}
