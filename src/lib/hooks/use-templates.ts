/**
 * Templates (IMP-098): the built-in layouts "New canvas" offers.
 */

import { apiFetch } from "@/lib/api/fetch-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { canvasKeys } from "@/lib/hooks/use-canvases";
import type {
  TemplateCategory,
  TemplateSummary,
} from "@/lib/templates/built-in";

export type { TemplateSummary } from "@/lib/templates/built-in";

interface TemplatesResponse {
  templates: TemplateSummary[];
  categories: Record<TemplateCategory, string>;
}

export const templateKeys = { all: ["templates"] as const };

export function useTemplates(enabled = true) {
  return useQuery({
    queryKey: templateKeys.all,
    enabled,
    staleTime: Infinity,
    queryFn: async () =>
      (await (await apiFetch("/api/v1/templates")).json()) as TemplatesResponse,
  });
}

export function useCreateFromTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      templateId: string;
      name?: string;
      workspaceId?: string;
    }) => {
      const { templateId, ...body } = input;
      const response = await apiFetch(
        `/api/v1/templates/${encodeURIComponent(templateId)}/use`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      return (await response.json()) as {
        id: string;
        name: string;
        itemCount: number;
      };
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: canvasKeys.all }),
  });
}
