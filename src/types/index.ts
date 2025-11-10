import { ItemType } from '@prisma/client';

export interface NoteContent {
  text: string;
}

export interface BookmarkContent {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
}

export interface CanvasItemBase {
  id: string;
  canvasId: string;
  type: ItemType;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  zIndex: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface NoteItem extends CanvasItemBase {
  type: ItemType.NOTE;
  content: NoteContent;
}

export interface BookmarkItem extends CanvasItemBase {
  type: ItemType.BOOKMARK;
  content: BookmarkContent;
}

export type CanvasItem = NoteItem | BookmarkItem;

export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: Record<string, string[]>;
}
