import type Konva from "konva";

const PIXEL_RATIO = 0.3;
const JPEG_QUALITY = 0.6;

/**
 * Dashboard preview of the stage as a small JPEG (IMP-083). The stage itself
 * is transparent and JPEG has no transparency, so it is drawn over the
 * canvas background colour first; otherwise every preview came out black.
 */
export function thumbnailDataUrl(stage: Konva.Stage, background: string) {
  const source = stage.toCanvas({ pixelRatio: PIXEL_RATIO });
  const output = document.createElement("canvas");
  output.width = source.width;
  output.height = source.height;
  const context = output.getContext("2d");
  if (!context) {
    return stage.toDataURL({
      pixelRatio: PIXEL_RATIO,
      mimeType: "image/jpeg",
      quality: JPEG_QUALITY,
    });
  }
  context.fillStyle = background;
  context.fillRect(0, 0, output.width, output.height);
  context.drawImage(source, 0, 0);
  return output.toDataURL("image/jpeg", JPEG_QUALITY);
}
