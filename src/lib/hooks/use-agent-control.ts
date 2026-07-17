"use client";

import { apiFetch } from "@/lib/api/fetch-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProviderSlot } from "@/lib/agents/providers";
import { canvasItemKeys } from "@/lib/hooks/use-canvas-items";

export interface AgentIntegrationAccount {
  id: string;
  agentProfileId: string;
  providerType: string;
  externalAccountId: string;
  authMode: string;
  status: string;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentProfileSummary {
  id: string;
  userId: string;
  name: string;
  status: string;
  maxCapabilityRung: number;
  enabledRungs: number[];
  allowedCanvasIds: string[];
  defaultModelCredentialId: string | null;
  createdAt: string;
  updatedAt: string;
  integrationAccounts: AgentIntegrationAccount[];
}

export interface AgentProviderCredential {
  id: string;
  provider: string;
  label: string;
  baseUrl: string | null;
  defaultModel: string;
  capabilities: unknown;
  dailySpendCap: number | null;
  monthlySpendCap: number | null;
  status: string;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentActionRecord {
  id: string;
  userId: string;
  agentProfileId: string;
  integrationAccountId: string | null;
  modelCredentialId: string | null;
  kind: string;
  rung: number;
  status: string;
  summary: string;
  requestFingerprint: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeRecordEntry {
  id: string;
  changeSetId: string;
  targetType: string;
  targetId: string;
  operation: string;
  before: unknown;
  after: unknown;
  reversible: boolean;
  revertedAt: string | null;
  createdAt: string;
}

export interface ChangeSetRecord {
  id: string;
  userId: string;
  agentProfileId: string;
  agentActionId: string | null;
  scopeType: string;
  scopeId: string;
  status: string;
  summary: string;
  startedAt: string;
  completedAt: string | null;
  revertedAt: string | null;
  changeRecords: ChangeRecordEntry[];
}

export interface SuggestionRecord {
  id: string;
  userId: string;
  agentProfileId: string | null;
  kind: string;
  status: string;
  summary: string;
  payload: Record<string, unknown>;
  expiresAt: string;
  actedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeEntityLink {
  id: string;
  itemId: string;
  knowledgeEntityId: string;
  linkType: string;
  confidence: number | null;
  createdAt: string;
}

export interface KnowledgeRelationEndpointEntity {
  id: string;
  entityType: string;
  title: string;
  status: string;
}

export interface KnowledgeRelationRecord {
  id: string;
  userId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  summary: string | null;
  status: string;
  attributes: Record<string, unknown> | null;
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
  sourceEntity: KnowledgeRelationEndpointEntity;
  targetEntity: KnowledgeRelationEndpointEntity;
}

export interface KnowledgeEntityRecord {
  id: string;
  userId: string;
  entityType: string;
  title: string;
  summary: string | null;
  status: string;
  attributes: Record<string, unknown> | null;
  sourceConfidence: number | null;
  createdAt: string;
  updatedAt: string;
  itemLinks: KnowledgeEntityLink[];
  outgoingRelations: KnowledgeRelationRecord[];
  incomingRelations: KnowledgeRelationRecord[];
}

export interface AgentTimelineResponse {
  actions: AgentActionRecord[];
  changeSets: ChangeSetRecord[];
  suggestions: SuggestionRecord[];
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const details = payload as Record<string, unknown>;
    if (typeof details.detail === "string") {
      return details.detail;
    }
    if (typeof details.error === "string") {
      return details.error;
    }
    if (typeof details.message === "string") {
      return details.message;
    }
  }

  return fallback;
}

async function parseJson<T>(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, fallback));
  }
  return payload as T;
}

const api = {
  async listAgentProfiles() {
    const response = await apiFetch("/api/v1/agent-profiles");
    return parseJson<{ agentProfiles: AgentProfileSummary[] }>(
      response,
      "Failed to load agent profiles.",
    );
  },

  async listProviders() {
    const response = await apiFetch("/api/agent/v1/providers");
    return parseJson<{
      providerSlots: ProviderSlot[];
      credentials: AgentProviderCredential[];
    }>(response, "Failed to load provider credentials.");
  },

  async listIntegrations() {
    const response = await apiFetch("/api/agent/v1/integrations");
    return parseJson<{ integrationAccounts: AgentIntegrationAccount[] }>(
      response,
      "Failed to load integration accounts.",
    );
  },

  async listTimeline(limit: number) {
    const response = await apiFetch(`/api/agent/v1/actions?limit=${limit}`);
    return parseJson<AgentTimelineResponse>(
      response,
      "Failed to load agent timeline.",
    );
  },

  async listKnowledge(canvasId: string) {
    const response = await apiFetch(
      `/api/agent/v1/knowledge?canvasId=${canvasId}`,
    );
    return parseJson<{ entities: KnowledgeEntityRecord[] }>(
      response,
      "Failed to load knowledge entities.",
    );
  },

  async approveSuggestion(suggestionId: string) {
    const response = await apiFetch("/api/agent/v1/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "approve-suggestion",
        suggestionId,
      }),
    });

    return parseJson<{ suggestion: SuggestionRecord }>(
      response,
      "Failed to approve suggestion.",
    );
  },

  async rejectSuggestion(suggestionId: string) {
    const response = await apiFetch("/api/agent/v1/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reject-suggestion",
        suggestionId,
      }),
    });

    return parseJson<{ suggestion: SuggestionRecord }>(
      response,
      "Failed to reject suggestion.",
    );
  },

  async executeSuggestion(suggestionId: string) {
    const response = await apiFetch("/api/agent/v1/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "execute-suggestion",
        suggestionId,
      }),
    });

    return parseJson<Record<string, unknown>>(
      response,
      "Failed to execute suggestion.",
    );
  },

  async revertChangeSet(changeSetId: string) {
    const response = await apiFetch("/api/agent/v1/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "revert-change-set",
        changeSetId,
      }),
    });

    return parseJson<Record<string, unknown>>(
      response,
      "Failed to revert change set.",
    );
  },
};

export const agentControlKeys = {
  all: ["agent-control"] as const,
  profiles: () => [...agentControlKeys.all, "profiles"] as const,
  providers: () => [...agentControlKeys.all, "providers"] as const,
  integrations: () => [...agentControlKeys.all, "integrations"] as const,
  timeline: (limit: number) =>
    [...agentControlKeys.all, "timeline", limit] as const,
  knowledge: (canvasId: string) =>
    [...agentControlKeys.all, "knowledge", canvasId] as const,
};

export function useAgentProfiles() {
  return useQuery({
    queryKey: agentControlKeys.profiles(),
    queryFn: api.listAgentProfiles,
  });
}

export function useAgentProviders() {
  return useQuery({
    queryKey: agentControlKeys.providers(),
    queryFn: api.listProviders,
  });
}

export function useAgentIntegrations() {
  return useQuery({
    queryKey: agentControlKeys.integrations(),
    queryFn: api.listIntegrations,
  });
}

export function useAgentTimeline(limit = 50) {
  return useQuery({
    queryKey: agentControlKeys.timeline(limit),
    queryFn: () => api.listTimeline(limit),
  });
}

export function useAgentKnowledge(canvasId: string) {
  return useQuery({
    queryKey: agentControlKeys.knowledge(canvasId),
    queryFn: () => api.listKnowledge(canvasId),
    enabled: !!canvasId,
  });
}

function invalidateAgentState(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: agentControlKeys.all });
  queryClient.invalidateQueries({ queryKey: canvasItemKeys.all });
}

export function useApproveSuggestion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.approveSuggestion,
    onSuccess: () => invalidateAgentState(queryClient),
  });
}

export function useRejectSuggestion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.rejectSuggestion,
    onSuccess: () => invalidateAgentState(queryClient),
  });
}

export function useExecuteSuggestion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.executeSuggestion,
    onSuccess: () => invalidateAgentState(queryClient),
  });
}

export function useRevertChangeSet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.revertChangeSet,
    onSuccess: () => invalidateAgentState(queryClient),
  });
}
