/**
 * Templates Hook
 * React Query hooks for managing canvas templates
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CanvasItem } from '@/types/canvas';

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
  items: CanvasItem[];
  user: {
    id: string;
    name: string | null;
    email: string;
  };
}

interface TemplatesResponse {
  templates: Template[];
}

/**
 * Fetch all templates, optionally filtered by category or user
 */
export function useTemplates(category?: string, userId?: string) {
  const params = new URLSearchParams();
  if (category) params.append('category', category);
  if (userId) params.append('userId', userId);

  const queryString = params.toString();
  const url = `/api/v1/templates${queryString ? `?${queryString}` : ''}`;

  return useQuery<TemplatesResponse>({
    queryKey: ['templates', category, userId],
    queryFn: async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch templates');
      }
      return response.json();
    },
  });
}

/**
 * Fetch a specific template by ID
 */
export function useTemplate(templateId: string) {
  return useQuery<Template>({
    queryKey: ['template', templateId],
    queryFn: async () => {
      const response = await fetch(`/api/v1/templates/${templateId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch template');
      }
      return response.json();
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
      description,
      category,
    }: {
      canvasId: string;
      description?: string;
      category?: string;
    }) => {
      const response = await fetch('/api/v1/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canvasId, description, category }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to save template');
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate templates list
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

/**
 * Use a template to create a new canvas
 */
export function useTemplate_CreateFromTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ templateId }: { templateId: string }) => {
      const response = await fetch(`/api/v1/templates/${templateId}/use`, {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to use template');
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate canvases list to show new canvas
      queryClient.invalidateQueries({ queryKey: ['canvases'] });
    },
  });
}

/**
 * Remove template status from a canvas
 */
export function useRemoveTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ templateId }: { templateId: string }) => {
      const response = await fetch(`/api/v1/templates/${templateId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to remove template');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}
