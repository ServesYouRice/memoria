"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  List,
  ListItem,
  ListItemText,
  Paper,
  Typography,
} from "@mui/material";
import { DeleteOutlined, Restore } from "@mui/icons-material";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import { useRestoreCanvas } from "@/lib/hooks/use-canvases";
import Link from "next/link";

type TrashItem = {
  id: string;
  type: string;
  content: unknown;
  version: number;
  deletedAt: string;
  /** Set when the item was archived: it stays here until restored. */
  archivedAt?: string | null;
  canvas: { id: string; name: string };
};

/** A whole canvas in Trash (IMP-132); restoring it brings everything back. */
type TrashCanvas = {
  id: string;
  name: string;
  deletedAt: string;
  itemCount: number;
};

const itemCount = (count: number) => `${count} item${count === 1 ? "" : "s"}`;

function itemLabel(item: TrashItem) {
  const content = item.content as Record<string, unknown> | null;
  return String(
    content?.title || content?.text || content?.filename || item.type,
  )
    .replace(/<[^>]+>/g, " ")
    .slice(0, 100);
}

export function TrashContent() {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ["trash"],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const response = await fetch(
        `/api/v1/trash?limit=50&offset=${pageParam}`,
      );
      if (!response.ok) throw new Error("Failed to load trash");
      return response.json() as Promise<{
        items: TrashItem[];
        canvases?: TrashCanvas[];
        pagination: { offset: number; limit: number; hasMore: boolean };
      }>;
    },
    getNextPageParam: (page) =>
      page.pagination.hasMore
        ? page.pagination.offset + page.pagination.limit
        : undefined,
  });
  const restore = useMutation({
    mutationFn: async (item: TrashItem) => {
      const response = await fetch("/api/v1/trash", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, version: item.version }),
      });
      if (!response.ok) throw new Error("Failed to restore item");
    },
    onSuccess: async () => {
      toast.success("Item restored");
      await queryClient.invalidateQueries({ queryKey: ["trash"] });
    },
    onError: () =>
      toast.error("Could not restore the item. Refresh and try again."),
  });
  const restoreCanvas = useRestoreCanvas();
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  // Every page carries the same canvas list; the first one is enough.
  const canvases = query.data?.pages[0]?.canvases ?? [];
  const bothSections = canvases.length > 0 && items.length > 0;

  return (
    <>
      <PageHeader
        title="Trash"
        subtitle={`Kept for ${LAUNCH_LIMITS.trashRetentionDays} days, then removed for good.`}
      />
      {query.error && (
        <Alert severity="error">Failed to load trash. Please try again.</Alert>
      )}
      {canvases.length > 0 && (
        <Box
          component="section"
          aria-labelledby="trash-canvases"
          sx={{ mb: 3 }}
        >
          <Typography
            id="trash-canvases"
            component="h2"
            variant="subtitle1"
            sx={{ fontWeight: 600, mb: 1 }}
          >
            Canvases
          </Typography>
          <Paper variant="outlined">
            <List disablePadding>
              {canvases.map((canvas) => (
                <ListItem
                  key={canvas.id}
                  divider
                  // Room for the Restore button so a long name wraps
                  // beside it instead of under it on a phone.
                  sx={{ pr: 16 }}
                  secondaryAction={
                    <Button
                      startIcon={<Restore />}
                      onClick={() =>
                        restoreCanvas.mutate(canvas.id, {
                          onSuccess: () => toast.success("Canvas restored"),
                          onError: (error) =>
                            toast.error(
                              error instanceof Error && error.message
                                ? error.message
                                : "Could not restore the canvas. Refresh and try again.",
                            ),
                        })
                      }
                      disabled={restoreCanvas.isPending}
                      aria-label={`Restore ${canvas.name}`}
                    >
                      Restore
                    </Button>
                  }
                >
                  <ListItemText
                    primary={canvas.name}
                    secondary={`Canvas · ${itemCount(canvas.itemCount)} · deleted ${formatDistanceToNow(new Date(canvas.deletedAt), { addSuffix: true })}`}
                    sx={{ overflowWrap: "anywhere" }}
                  />
                </ListItem>
              ))}
            </List>
          </Paper>
        </Box>
      )}
      {bothSections && (
        <Typography
          component="h2"
          variant="subtitle1"
          sx={{ fontWeight: 600, mb: 1 }}
        >
          Items
        </Typography>
      )}
      {!query.isLoading &&
        !query.error &&
        items.length === 0 &&
        canvases.length === 0 && (
          <EmptyState
            icon={DeleteOutlined}
            title="Trash is empty"
            description={`Items you delete from a canvas wait here for ${LAUNCH_LIMITS.trashRetentionDays} days, so you can restore them before they are removed for good.`}
            action={
              <Button component={Link} href="/dashboard" variant="contained">
                Back to the dashboard
              </Button>
            }
          />
        )}
      {items.length > 0 && (
        <Paper variant="outlined">
          <List disablePadding>
            {items.map((item) => (
              <ListItem
                key={item.id}
                divider
                secondaryAction={
                  <Button
                    startIcon={<Restore />}
                    onClick={() => restore.mutate(item)}
                    disabled={restore.isPending}
                  >
                    Restore
                  </Button>
                }
              >
                <ListItemText
                  primary={itemLabel(item)}
                  secondary={`${item.canvas.name} · ${item.archivedAt ? "archived" : "deleted"} ${formatDistanceToNow(new Date(item.deletedAt), { addSuffix: true })}${item.archivedAt ? " · kept until you restore it" : ""}`}
                />
              </ListItem>
            ))}
          </List>
        </Paper>
      )}
      {query.hasNextPage && (
        <Box sx={{ textAlign: "center", mt: 2 }}>
          <Button
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </Box>
      )}
    </>
  );
}
