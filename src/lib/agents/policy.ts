import { AgentProfileStatus } from "@/generated/prisma/client";
import { ForbiddenError } from "@/lib/errors";

interface ScopedAgentProfile {
  status: AgentProfileStatus;
  maxCapabilityRung: number;
  enabledRungs: number[];
  allowedCanvasIds: string[];
}

export function assertAgentCapability(
  agentProfile: ScopedAgentProfile | null,
  requiredRung: number,
) {
  if (!agentProfile) {
    return;
  }

  if (agentProfile.status !== AgentProfileStatus.ACTIVE) {
    throw new ForbiddenError("The selected agent profile is not active.");
  }

  if (requiredRung > agentProfile.maxCapabilityRung) {
    throw new ForbiddenError(
      "The selected agent profile is not allowed to use this capability rung.",
    );
  }

  if (!agentProfile.enabledRungs.includes(requiredRung)) {
    throw new ForbiddenError(
      "This capability rung is disabled for the selected agent profile.",
    );
  }
}

export function assertCanvasScope(
  agentProfile: ScopedAgentProfile | null,
  canvasId: string,
) {
  if (!agentProfile) {
    return;
  }

  if (!agentProfile.allowedCanvasIds.includes(canvasId)) {
    throw new ForbiddenError(
      "The selected agent profile is not allowed to access this canvas.",
    );
  }
}
