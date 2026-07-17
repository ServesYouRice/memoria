/**
 * Templates Hook
 * React Query hooks for managing canvas templates
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type CanvasItem } from "@/types/canvas";

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

export interface Template {
  id: string;
  name: string;
  userId: string;
  templateDescription: string | null;
  templateCategory: string | null;
  usageCount: number;
  zoomLevel: number;
  panX: number;
  panY: number;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  items?: CanvasItem[];
  user: {
    id: string;
    name: string | null;
  };
}

interface TemplatesResponse {
  templates: Template[];
  pagination?: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

interface CreatedCanvas {
  id: string;
}

/**
 * Fetch all templates, optionally filtered by category or user
 */
export function useTemplates(category?: string, userId?: string) {
  const params = new URLSearchParams();
  if (category) params.append("category", category);
  if (userId) params.append("userId", userId);

  return useQuery<TemplatesResponse>({
    queryKey: ["templates", category, userId],
    queryFn: async () => {
      const templates: Template[] = [];
      let offset = 0;
      let total = 0;
      let hasMore = true;
      while (hasMore) {
        const pageParams = new URLSearchParams(params);
        pageParams.set("limit", "100");
        pageParams.set("offset", String(offset));
        const response = await fetch(`/api/v1/templates?${pageParams}`);
        const page = await parseJson<TemplatesResponse>(
          response,
          "Failed to fetch templates",
        );
        templates.push(...page.templates);
        total = page.pagination?.total ?? templates.length;
        offset += page.templates.length;
        hasMore = Boolean(
          page.pagination?.hasMore && page.templates.length > 0,
        );
      }
      return {
        templates,
        pagination: {
          total,
          limit: templates.length,
          offset: 0,
          hasMore: false,
        },
      };
    },
  });
}

/**
 * Fetch a specific template by ID
 */
export function useTemplate(templateId: string) {
  return useQuery<Template>({
    queryKey: ["template", templateId],
    queryFn: async () => {
      const response = await fetch(`/api/v1/templates/${templateId}`);
      return parseJson<Template>(response, "Failed to fetch template");
    },
    enabled: !!templateId,
  });
}

/**
 * Save a canvas as a template
 */
export function useSaveAsTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      canvasId,
      name,
      description,
      category,
      isPublic,
    }: {
      canvasId: string;
      name?: string;
      description?: string;
      category?: string;
      isPublic?: boolean;
    }) => {
      const response = await fetch("/api/v1/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canvasId,
          name,
          description,
          category,
          isPublic,
        }),
      });

      return parseJson<Template>(response, "Failed to save template");
    },
    onSuccess: () => {
      // Invalidate templates list
      queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });
}

/**
 * Use a template to create a new canvas
 */
export function useCreateCanvasFromTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ templateId }: { templateId: string }) => {
      const response = await fetch(`/api/v1/templates/${templateId}/use`, {
        method: "POST",
      });

      return parseJson<CreatedCanvas>(response, "Failed to use template");
    },
    onSuccess: () => {
      // Invalidate canvases list to show new canvas
      queryClient.invalidateQueries({ queryKey: ["canvases"] });
    },
  });
}

export const useTemplate_CreateFromTemplate = useCreateCanvasFromTemplate;

/**
 * Remove template status from a canvas
 */
export function useRemoveTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ templateId }: { templateId: string }) => {
      const response = await fetch(`/api/v1/templates/${templateId}`, {
        method: "DELETE",
      });

      return parseJson<Record<string, unknown>>(
        response,
        "Failed to remove template",
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });
}
