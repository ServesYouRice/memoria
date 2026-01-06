/**
 * API Keys Hook
 * React Query hooks for managing API keys
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPreview: string | null;
  keyPrefix: string | null;
  keySuffix: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

interface ApiKeysResponse {
  keys: ApiKeySummary[];
}

export function useApiKeys() {
  return useQuery<ApiKeysResponse>({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const response = await fetch('/api/v1/api-keys');
      if (!response.ok) {
        throw new Error('Failed to fetch API keys');
      }
      return response.json();
    },
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ name, expiresAt }: { name: string; expiresAt?: string | null }) => {
      const response = await fetch('/api/v1/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, expiresAt }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create API key');
      }

      return response.json() as Promise<{ apiKey: ApiKeySummary; plaintextKey: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ keyId }: { keyId: string }) => {
      const response = await fetch(`/api/v1/api-keys/${keyId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to revoke API key');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
}
