/**
 * Raster image type detection by magic bytes (IMP-057)
 *
 * The image proxy trusts the bytes, not the upstream `Content-Type`: favicons
 * are often served as `text/plain` or `application/octet-stream`, and a hostile
 * host can label HTML as `image/png`. Only these raster formats are served.
 * SVG has no signature here on purpose: it is a script-capable document and is
 * rejected rather than sanitized.
 */

export type ProxiedImageType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp"
  | "image/avif"
  | "image/x-icon";

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

export function sniffImageType(bytes: Uint8Array): ProxiedImageType | null {
  if (bytes.length < 12) return null;

  if (
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 4) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const gif = ascii(bytes, 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  // ICO: reserved 0, type 1 (icon), at least one image.
  if (
    bytes[0] === 0 &&
    bytes[1] === 0 &&
    bytes[2] === 1 &&
    bytes[3] === 0 &&
    (bytes[4]! > 0 || bytes[5]! > 0)
  ) {
    return "image/x-icon";
  }
  return null;
}
