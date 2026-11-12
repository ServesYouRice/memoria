"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Button } from "@mui/material";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  BLANK_TEMPLATE,
  TemplatePicker,
} from "@/features/dashboard/components/TemplatePicker";
import { useCreateCanvas } from "@/lib/hooks/use-canvases";
import { useCreateFromTemplate, useTemplates } from "@/lib/hooks/use-templates";

/** IMP-098 — every built-in template; picking one makes a new canvas. */
export function TemplatesContent() {
  const router = useRouter();
  const templates = useTemplates();
  const createBlank = useCreateCanvas();
  const createFromTemplate = useCreateFromTemplate();
  const [choice, setChoice] = useState(BLANK_TEMPLATE);
  const [error, setError] = useState<string | null>(null);
  const busy = createBlank.isPending || createFromTemplate.isPending;

  const create = async () => {
    setError(null);
    try {
      const canvas =
        choice === BLANK_TEMPLATE
          ? await createBlank.mutateAsync({})
          : await createFromTemplate.mutateAsync({ templateId: choice });
      router.push(`/canvas/${canvas.id}`);
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : "The canvas could not be made.",
      );
    }
  };

  return (
    <>
      <PageHeader
        title="Templates"
        subtitle="Start a canvas from a ready-made layout"
        actions={
          <Button
            variant="contained"
            onClick={() => void create()}
            disabled={busy}
          >
            {busy ? "Making…" : "Use this"}
          </Button>
        }
      />
      {(error || templates.isError) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error ?? "Templates could not be loaded."}
        </Alert>
      )}
      <Box sx={{ mb: 4 }}>
        <TemplatePicker
          templates={templates.data?.templates}
          loading={templates.isLoading}
          value={choice}
          onChange={setChoice}
        />
      </Box>
    </>
  );
}
