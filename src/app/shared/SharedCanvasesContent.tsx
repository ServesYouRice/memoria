"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Alert, Chip } from "@mui/material";
import {
  PeopleAltOutlined as SharedIcon,
  VisibilityOutlined as ViewIcon,
  ChatBubbleOutlined as CommentIcon,
  EditOutlined as EditIcon,
} from "@mui/icons-material";
import { formatDistanceToNow } from "date-fns";
import { useSharedCanvases } from "@/lib/hooks/use-canvases";
import {
  CanvasCard,
  CanvasCardSkeleton,
  CardGrid,
} from "@/features/dashboard/components/CanvasCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";

const ROLE_META = {
  VIEW: { label: "Can view", icon: <ViewIcon />, color: "default" as const },
  COMMENT: {
    label: "Can comment",
    icon: <CommentIcon />,
    color: "info" as const,
  },
  EDIT: { label: "Can edit", icon: <EditIcon />, color: "success" as const },
};

export function SharedCanvasesContent() {
  const router = useRouter();
  const { data: canvases, isLoading, error } = useSharedCanvases();

  const items = canvases ?? [];

  return (
    <>
      <PageHeader
        title="Shared with me"
        subtitle={
          isLoading
            ? "Loading…"
            : `${items.length} canvas${items.length === 1 ? "" : "es"} shared by other people`
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load shared canvases. Please try again.
        </Alert>
      )}

      {isLoading && (
        <CardGrid>
          {[0, 1, 2, 3].map((i) => (
            <CanvasCardSkeleton key={i} index={i} />
          ))}
        </CardGrid>
      )}

      {!isLoading && !error && items.length === 0 && (
        <EmptyState
          icon={SharedIcon}
          title="Nothing shared with you yet"
          description="When someone shares a canvas with you, it will show up here. Ask a teammate to share one from their canvas's Share dialog."
        />
      )}

      {!isLoading && items.length > 0 && (
        <CardGrid>
          {items.map((canvas, index) => {
            const role = ROLE_META[canvas.role] ?? ROLE_META.VIEW;
            return (
              <CanvasCard
                key={canvas.id}
                name={canvas.name}
                thumbnail={canvas.thumbnail}
                index={index}
                onClick={() => router.push(`/canvas/${canvas.id}`)}
                badge={
                  <Chip
                    size="small"
                    icon={role.icon}
                    label={role.label}
                    color={role.color}
                    sx={{ bgcolor: "background.paper" }}
                    variant="outlined"
                  />
                }
                meta={`By ${canvas.owner.name || "Unknown"} • ${canvas.itemCount} item${
                  canvas.itemCount === 1 ? "" : "s"
                } • Updated ${formatDistanceToNow(new Date(canvas.updatedAt), { addSuffix: true })}`}
              />
            );
          })}
        </CardGrid>
      )}
    </>
  );
}
