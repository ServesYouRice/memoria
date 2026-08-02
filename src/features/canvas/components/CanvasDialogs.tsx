"use client";

import React from "react";
import dynamic from "next/dynamic";
import type Konva from "konva";
import { type CanvasCapabilities, type CanvasItem } from "@/types/canvas";
import {
  CanvasContextMenu,
  type ContextMenuPosition,
} from "@/features/canvas/components/CanvasContextMenu";
import { CommentsPanel } from "@/features/canvas/components/CommentsPanel";
import { TagFilterPanel } from "@/features/canvas/components/TagFilterPanel";
import { SerendipityDialog } from "@/features/canvas/components/SerendipityDialog";
import { WhisperMode } from "@/features/canvas/components/WhisperMode";
import { ARCanvasLayer } from "@/features/canvas/components/ARCanvasLayer";

const EditNoteDialog = dynamic(
  () =>
    import("@/features/canvas/components/EditNoteDialog").then(
      (mod) => mod.EditNoteDialog,
    ),
  { ssr: false },
);
const EditBookmarkDialog = dynamic(
  () =>
    import("@/features/canvas/components/EditBookmarkDialog").then(
      (mod) => mod.EditBookmarkDialog,
    ),
  { ssr: false },
);
const EditImageDialog = dynamic(
  () =>
    import("@/features/canvas/components/EditImageDialog").then(
      (mod) => mod.EditImageDialog,
    ),
  { ssr: false },
);
const CreateNoteDialog = dynamic(
  () =>
    import("@/features/canvas/components/CreateNoteDialog").then(
      (mod) => mod.CreateNoteDialog,
    ),
  { ssr: false },
);
const CreateBookmarkDialog = dynamic(
  () =>
    import("@/features/canvas/components/CreateBookmarkDialog").then(
      (mod) => mod.CreateBookmarkDialog,
    ),
  { ssr: false },
);
const CreateImageDialog = dynamic(
  () =>
    import("@/features/canvas/components/CreateImageDialog").then(
      (mod) => mod.CreateImageDialog,
    ),
  { ssr: false },
);
const VersionHistoryDialog = dynamic(
  () =>
    import("@/features/canvas/components/VersionHistoryDialog").then(
      (mod) => mod.VersionHistoryDialog,
    ),
  { ssr: false },
);
const ExportDialog = dynamic(
  () =>
    import("@/features/canvas/components/ExportDialog").then(
      (mod) => mod.ExportDialog,
    ),
  { ssr: false },
);
const AIDialog = dynamic(
  () =>
    import("@/features/canvas/components/AIDialog").then((mod) => mod.AIDialog),
  { ssr: false },
);

interface CanvasDialogsProps {
  capabilities: CanvasCapabilities;
  canvasId: string;
  canvasName: string;
  items: CanvasItem[];
  stageRef: React.RefObject<Konva.Stage>;
  collaborators: {
    userId: string;
    name?: string;
    email: string;
    color: string;
  }[];

  noteDialogOpen: boolean;
  setNoteDialogOpen: (open: boolean) => void;
  bookmarkDialogOpen: boolean;
  setBookmarkDialogOpen: (open: boolean) => void;
  imageDialogOpen: boolean;
  setImageDialogOpen: (open: boolean) => void;

  editNoteDialogOpen: boolean;
  setEditNoteDialogOpen: (open: boolean) => void;
  editingNoteItem: CanvasItem | null;
  setEditingNoteItem: (item: CanvasItem | null) => void;
  editBookmarkDialogOpen: boolean;
  setEditBookmarkDialogOpen: (open: boolean) => void;
  editingBookmarkItem: CanvasItem | null;
  setEditingBookmarkItem: (item: CanvasItem | null) => void;
  editImageDialogOpen: boolean;
  setEditImageDialogOpen: (open: boolean) => void;
  editingImageItem: CanvasItem | null;
  setEditingImageItem: (item: CanvasItem | null) => void;

  versionHistoryOpen: boolean;
  setVersionHistoryOpen: (open: boolean) => void;
  exportDialogOpen: boolean;
  setExportDialogOpen: (open: boolean) => void;

  tagFilterOpen: boolean;
  setTagFilterOpen: (open: boolean) => void;
  allTags: string[];
  selectedTags: string[];
  setSelectedTags: (tags: string[]) => void;
  tagCounts: Record<string, number>;

  contextMenuPosition: ContextMenuPosition | null;
  setContextMenuPosition: (position: ContextMenuPosition | null) => void;
  onDeleteFromMenu: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onOpenComments: () => void;

  commentsPanelOpen: boolean;
  setCommentsPanelOpen: (open: boolean) => void;
  commentsItemId: string | null;
  setCommentsItemId: (itemId: string | null) => void;

  aiDialogOpen: boolean;
  setAiDialogOpen: (open: boolean) => void;
  onAddNoteFromAI: (text: string) => void;
  getAIContext: () => string;

  serendipityOpen: boolean;
  setSerendipityOpen: (open: boolean) => void;
  onAddSerendipityItems: (items: any[]) => Promise<void>;

  whisperOpen: boolean;
  setWhisperOpen: (open: boolean) => void;
  onWhisperSend: (text: string) => Promise<void>;

  arOpen: boolean;
  setAROpen: (open: boolean) => void;
}

export function CanvasDialogs({
  capabilities,
  canvasId,
  canvasName,
  items,
  stageRef,
  collaborators,
  noteDialogOpen,
  setNoteDialogOpen,
  bookmarkDialogOpen,
  setBookmarkDialogOpen,
  imageDialogOpen,
  setImageDialogOpen,
  editNoteDialogOpen,
  setEditNoteDialogOpen,
  editingNoteItem,
  setEditingNoteItem,
  editBookmarkDialogOpen,
  setEditBookmarkDialogOpen,
  editingBookmarkItem,
  setEditingBookmarkItem,
  editImageDialogOpen,
  setEditImageDialogOpen,
  editingImageItem,
  setEditingImageItem,
  versionHistoryOpen,
  setVersionHistoryOpen,
  exportDialogOpen,
  setExportDialogOpen,
  tagFilterOpen,
  setTagFilterOpen,
  allTags,
  selectedTags,
  setSelectedTags,
  tagCounts,
  contextMenuPosition,
  setContextMenuPosition,
  onDeleteFromMenu,
  onDuplicate,
  onCopy,
  onOpenComments,
  commentsPanelOpen,
  setCommentsPanelOpen,
  commentsItemId,
  setCommentsItemId,
  aiDialogOpen,
  setAiDialogOpen,
  onAddNoteFromAI,
  getAIContext,
  serendipityOpen,
  setSerendipityOpen,
  onAddSerendipityItems,
  whisperOpen,
  setWhisperOpen,
  onWhisperSend,
  arOpen,
  setAROpen,
}: CanvasDialogsProps) {
  return (
    <>
      {capabilities.canCreateItems && (
        <>
          <CreateNoteDialog
            open={noteDialogOpen}
            onClose={() => setNoteDialogOpen(false)}
            canvasId={canvasId}
            initialPosition={{ x: 100, y: 100 }}
          />
          <CreateBookmarkDialog
            open={bookmarkDialogOpen}
            onClose={() => setBookmarkDialogOpen(false)}
            canvasId={canvasId}
            initialPosition={{ x: 100, y: 100 }}
          />
          <CreateImageDialog
            open={imageDialogOpen}
            onClose={() => setImageDialogOpen(false)}
            canvasId={canvasId}
            initialPosition={{ x: 100, y: 100 }}
          />
        </>
      )}

      {capabilities.canEditItems && (
        <>
          <EditNoteDialog
            open={editNoteDialogOpen}
            onClose={() => {
              setEditNoteDialogOpen(false);
              setEditingNoteItem(null);
            }}
            item={editingNoteItem}
          />
          <EditBookmarkDialog
            open={editBookmarkDialogOpen}
            onClose={() => {
              setEditBookmarkDialogOpen(false);
              setEditingBookmarkItem(null);
            }}
            item={editingBookmarkItem}
          />
          <EditImageDialog
            open={editImageDialogOpen}
            onClose={() => {
              setEditImageDialogOpen(false);
              setEditingImageItem(null);
            }}
            item={editingImageItem}
          />
        </>
      )}

      {capabilities.canManageCanvas && (
        <>
          <VersionHistoryDialog
            open={versionHistoryOpen}
            onClose={() => setVersionHistoryOpen(false)}
            canvasId={canvasId}
          />
        </>
      )}

      <ExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        canvasId={canvasId}
        canvasName={canvasName}
        items={items}
        stageRef={stageRef}
      />

      <TagFilterPanel
        open={tagFilterOpen}
        onClose={() => setTagFilterOpen(false)}
        allTags={allTags || []}
        selectedTags={selectedTags}
        onTagsChange={setSelectedTags}
        tagCounts={tagCounts || {}}
      />

      <CanvasContextMenu
        position={contextMenuPosition}
        onClose={() => setContextMenuPosition(null)}
        onDelete={onDeleteFromMenu}
        onDuplicate={onDuplicate}
        onCopy={onCopy}
        onComments={onOpenComments}
        capabilities={capabilities}
      />

      {capabilities.canComment && commentsItemId && (
        <CommentsPanel
          open={commentsPanelOpen}
          onClose={() => {
            setCommentsPanelOpen(false);
            setCommentsItemId(null);
          }}
          itemId={commentsItemId}
          itemType={
            items.find((item) => item.id === commentsItemId)?.type || "NOTE"
          }
          collaborators={collaborators}
        />
      )}

      {capabilities.canEditItems && aiDialogOpen && (
        <AIDialog
          open={aiDialogOpen}
          onClose={() => setAiDialogOpen(false)}
          canvasId={canvasId}
          onAddNote={onAddNoteFromAI}
          getContext={getAIContext}
        />
      )}

      {serendipityOpen && (
        <SerendipityDialog
          open={serendipityOpen}
          onClose={() => setSerendipityOpen(false)}
          canvasId={canvasId}
          onAddItems={onAddSerendipityItems}
        />
      )}

      {whisperOpen && (
        <WhisperMode
          open={whisperOpen}
          onClose={() => setWhisperOpen(false)}
          onSend={onWhisperSend}
        />
      )}

      {arOpen && (
        <ARCanvasLayer
          open={arOpen}
          onClose={() => setAROpen(false)}
          items={items.map((item) => ({
            id: item.id,
            type: item.type,
            content: item.content as {
              text?: string;
              title?: string;
              url?: string;
            },
            positionX: item.positionX,
            positionY: item.positionY,
          }))}
        />
      )}
    </>
  );
}
