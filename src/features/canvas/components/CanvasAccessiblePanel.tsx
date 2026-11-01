"use client";

/**
 * IMP-022 — the always-present accessible surface for a canvas.
 *
 * The item list is rendered into the DOM unconditionally so screen readers and
 * the accessibility tree always see canvas content. Visually it stays out of the
 * way until someone reaches it: a visible skip control focuses it, and the panel
 * reveals itself whenever focus is inside (`:focus-within`), so keyboard users
 * see what they are operating.
 *
 * It is never `display: none` or `hidden` — that would remove it from the
 * accessibility tree and undo the point of the panel.
 */

import React, { useId, useMemo, useRef } from "react";
import { Box, Button, Paper } from "@mui/material";
import {
  CanvasItemListView,
  type CanvasItemListViewProps,
} from "./CanvasItemListView";
import { useAccessibleCanvasItems } from "@/lib/hooks/use-canvas-items";
import {
  rendersFromDocument,
  useCanvasDocument,
  useCanvasDocumentSnapshot,
} from "@/lib/hooks/use-canvas-document";
import { overlayDocumentItems } from "@/lib/collaboration/sync/canvas-view";
import type { CanvasItem } from "@/types/canvas";

type CanvasAccessiblePanelProps = Omit<CanvasItemListViewProps, "items"> & {
  canvasId?: string;
  items?: CanvasItemListViewProps["items"];
};

function PaginatedAccessibleItems({
  canvasId,
  props,
}: {
  canvasId: string;
  props: Omit<CanvasItemListViewProps, "items">;
}) {
  const query = useAccessibleCanvasItems(canvasId);
  const rows = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  // IMP-045: without a connection the rows stop following the document, and
  // a canvas opened offline has none. The list then shows the document's
  // items, so it lists (and nudges from) what the board shows.
  const session = useCanvasDocument();
  const snapshot = useCanvasDocumentSnapshot(session);
  const fromDocument =
    session?.canvasId === canvasId &&
    rendersFromDocument(snapshot) &&
    (!snapshot.connected || snapshot.restored || !query.data);
  const documentItems = useMemo(
    () =>
      fromDocument
        ? overlayDocumentItems({
            canvasId,
            entries: snapshot.items,
            queried: rows as unknown as CanvasItem[],
          })
        : null,
    [canvasId, fromDocument, rows, snapshot.items],
  );
  if (documentItems)
    return (
      <CanvasItemListView
        {...props}
        items={documentItems}
        totalItems={documentItems.length}
        hasMore={false}
      />
    );

  const totalItems = query.data?.pages[0]?.total ?? rows.length;
  return (
    <CanvasItemListView
      {...props}
      items={rows as unknown as CanvasItemListViewProps["items"]}
      totalItems={totalItems}
      hasMore={query.hasNextPage}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => void query.fetchNextPage()}
    />
  );
}

export function CanvasAccessiblePanel({
  canvasId,
  items: suppliedItems,
  ...props
}: CanvasAccessiblePanelProps) {
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <Button
        onClick={() => {
          const firstItem =
            panelRef.current?.querySelector<HTMLElement>("[tabindex='0']");
          (firstItem ?? panelRef.current)?.focus();
        }}
        aria-controls={panelId}
        sx={{
          // Visible only while focused, like a skip link: discoverable by
          // keyboard without adding chrome for pointer users.
          position: "absolute",
          zIndex: (theme) => theme.zIndex.tooltip,
          left: 8,
          top: 8,
          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: "divider",
          "&:not(:focus-visible)": {
            width: 1,
            height: 1,
            p: 0,
            m: 0,
            minWidth: 0,
            overflow: "hidden",
            clip: "rect(0 0 0 0)",
            whiteSpace: "nowrap",
          },
        }}
      >
        Skip to accessible item list
      </Button>

      <Paper
        id={panelId}
        ref={panelRef}
        elevation={8}
        sx={{
          position: "absolute",
          zIndex: (theme) => theme.zIndex.drawer,
          insetInlineStart: 0,
          top: 0,
          maxHeight: "100%",
          width: { xs: "100%", sm: 420 },
          overflowY: "auto",
          // Present in the accessibility tree at all times; only clipped out of
          // sight until focus enters.
          "&:not(:focus-within)": {
            width: 1,
            height: 1,
            overflow: "hidden",
            clip: "rect(0 0 0 0)",
            whiteSpace: "nowrap",
          },
        }}
      >
        <Box sx={{ minWidth: { xs: 280, sm: 380 } }}>
          {canvasId ? (
            <PaginatedAccessibleItems canvasId={canvasId} props={props} />
          ) : (
            <CanvasItemListView {...props} items={suppliedItems || []} />
          )}
        </Box>
      </Paper>
    </>
  );
}
