"use client";

/**
 * IMP-069: frame (pile) context-menu entries that turn the pile into a new
 * note — summary, checklist or comparison table. Offered only to people who
 * can edit the canvas, and only when an AI provider is configured for them;
 * the server checks both again.
 */
import React, { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Divider, ListItemIcon, ListItemText, MenuItem } from "@mui/material";
import {
  Checklist as ChecklistIcon,
  Notes as SummaryIcon,
  TableChart as TableIcon,
} from "@mui/icons-material";
import { toast } from "sonner";
import { canvasItemKeys } from "@/lib/hooks/use-canvas-items";
import {
  AI_NOT_SET_UP_MESSAGE,
  AI_SETUP_PATH,
  aiSetupNeeded,
} from "@/features/ai/ai-setup";
import type { PileTransformKind } from "@/lib/ai/pile-transform-kinds";

const PILE_ACTIONS: Array<{
  kind: PileTransformKind;
  label: string;
  icon: React.ReactNode;
}> = [
  {
    kind: "summary",
    label: "Summarize pile into a note",
    icon: <SummaryIcon fontSize="small" />,
  },
  {
    kind: "checklist",
    label: "Turn pile into a checklist",
    icon: <ChecklistIcon fontSize="small" />,
  },
  {
    kind: "table",
    label: "Compare pile in a table",
    icon: <TableIcon fontSize="small" />,
  },
];

export const AI_AVAILABILITY_QUERY_KEY = ["ai", "provider", "availability"];
const FAILURE = "Could not turn this pile into a note.";

async function fetchAiConfigured(): Promise<boolean> {
  const response = await fetch("/api/v1/ai/provider");
  if (!response.ok) return false;
  const payload = (await response.json().catch(() => null)) as {
    availability?: { configured?: boolean };
  } | null;
  return payload?.availability?.configured === true;
}

async function readProblem(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    detail?: string;
  } | null;
  return payload?.detail || FAILURE;
}

export function usePileTransform(
  canvasId: string | undefined,
  enabled: boolean,
) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PileTransformKind | null>(null);
  const busy = useRef(false);

  const { data: configured = false } = useQuery({
    queryKey: AI_AVAILABILITY_QUERY_KEY,
    queryFn: fetchAiConfigured,
    enabled: enabled && Boolean(canvasId),
    staleTime: 5 * 60 * 1000,
  });

  const run = useCallback(
    async (frameId: string, kind: PileTransformKind) => {
      if (!canvasId || busy.current) return;
      busy.current = true;
      setPending(kind);
      try {
        const response = await fetch("/api/v1/ai/summarize/pile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ canvasId, frameId, kind }),
        });
        if (!response.ok) {
          if (await aiSetupNeeded(response)) {
            // IMP-102: point straight at the AI set-up.
            toast.error(AI_NOT_SET_UP_MESSAGE, {
              action: {
                label: "Set up AI",
                onClick: () => window.location.assign(AI_SETUP_PATH),
              },
            });
            return;
          }
          throw new Error(await readProblem(response));
        }
        // The committed event also delivers the note; this covers a missed one.
        await queryClient.invalidateQueries({
          queryKey: canvasItemKeys.list(canvasId),
        });
        toast.success("Note added next to the pile.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : FAILURE);
      } finally {
        busy.current = false;
        setPending(null);
      }
    },
    [canvasId, queryClient],
  );

  return { available: enabled && configured, pending, run };
}

/** Menu entries; an array because MUI Menu needs direct children. */
export function pileTransformMenuItems(options: {
  pending: PileTransformKind | null;
  onSelect: (kind: PileTransformKind) => void;
}): React.ReactNode[] {
  return [
    <Divider key="pile-ai-divider" />,
    ...PILE_ACTIONS.map((action) => (
      <MenuItem
        key={`pile-ai-${action.kind}`}
        disabled={options.pending !== null}
        onClick={() => options.onSelect(action.kind)}
      >
        <ListItemIcon>{action.icon}</ListItemIcon>
        <ListItemText>
          {options.pending === action.kind ? "Working…" : action.label}
        </ListItemText>
      </MenuItem>
    )),
  ];
}
