export function canvasThumbnailUrl(canvas: {
  id: string;
  thumbnailKey?: string | null;
  thumbnailRevision?: string | number | bigint | null;
}): string | null {
  if (!canvas.thumbnailKey) return null;
  return `/api/v1/canvases/${canvas.id}/thumbnail?v=${String(
    canvas.thumbnailRevision ?? "0",
  )}`;
}
