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
} from "@mui/material";
import { DeleteOutlined, Restore } from "@mui/icons-material";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";

type TrashItem = {
  id: string;
  type: string;
  content: unknown;
  version: number;
  deletedAt: string;
  canvas: { id: string; name: string };
};

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
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader
        title="Trash"
        subtitle="Restore soft-deleted items from canvases you own"
      />
      {query.error && (
        <Alert severity="error">Failed to load trash. Please try again.</Alert>
      )}
      {!query.isLoading && !query.error && items.length === 0 && (
        <EmptyState
          icon={DeleteOutlined}
          title="Trash is empty"
          description="Deleted canvas items will appear here."
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
                  secondary={`${item.canvas.name} · deleted ${formatDistanceToNow(new Date(item.deletedAt), { addSuffix: true })}`}
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
