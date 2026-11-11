/**
 * Header-only image bounds checks.
 *
 * Magic bytes say what a file claims to be; they say nothing about how much
 * memory a decoder (browser, thumbnailer, scanner) needs to open it. A few
 * kilobytes of PNG/GIF/WebP can declare tens of thousands of pixels per edge
 * or thousands of frames. These parsers read only the container headers (no
 * pixel decoding) so the upload route can reject decode bombs cheaply.
 */

export const MAX_IMAGE_EDGE = 10_000;
export const MAX_IMAGE_PIXELS = 25_000_000;
export const MAX_IMAGE_FRAMES = 120;
/** Bound on width * height * frames for animated images. */
export const MAX_IMAGE_TOTAL_PIXELS = 150_000_000;

export interface ImageInfo {
  width: number;
  height: number;
  frames: number;
}

export type ImageBoundsResult =
  { ok: true; info: ImageInfo } | { ok: false; reason: string };

function fail(reason: string): ImageBoundsResult {
  return { ok: false, reason };
}

function parsePng(buf: Buffer): ImageInfo | null {
  // Signature (8) + IHDR chunk: length(4) "IHDR"(4) width(4) height(4)
  if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR") {
    return null;
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);

  // acTL (APNG frame count) must precede the first IDAT.
  let frames = 1;
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    if (type === "acTL" && pos + 12 <= buf.length) {
      frames = buf.readUInt32BE(pos + 8);
      break;
    }
    if (type === "IDAT" || type === "IEND") break;
    pos += 12 + length;
  }
  return { width, height, frames };
}

function parseJpeg(buf: Buffer): ImageInfo | null {
  let pos = 2;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) {
      pos += 1;
      continue;
    }
    const marker = buf[pos + 1];
    if (marker === 0xff) {
      pos += 1; // fill byte
      continue;
    }
    // Standalone markers carry no length: stuffed zero, TEM, RSTn, SOI, EOI.
    if (
      marker === 0x00 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd9)
    ) {
      pos += 2;
      continue;
    }
    const segmentLength = buf.readUInt16BE(pos + 2);
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      if (pos + 9 > buf.length) return null;
      return {
        height: buf.readUInt16BE(pos + 5),
        width: buf.readUInt16BE(pos + 7),
        frames: 1,
      };
    }
    if (marker === 0xda) return null; // start of scan before any SOF
    pos += 2 + segmentLength;
  }
  return null;
}

function parseGif(buf: Buffer): ImageInfo | null {
  if (buf.length < 13) return null;
  // Decoders grow the canvas to fit any frame that overflows the logical
  // screen, so the effective size covers every image descriptor too.
  let width = buf.readUInt16LE(6);
  let height = buf.readUInt16LE(8);
  const flags = buf[10];
  let pos = 13;
  if (flags & 0x80) pos += 3 * 2 ** ((flags & 0x07) + 1);
  if (pos > buf.length) return null;

  // Returns false when the sub-block chain runs past the end of the buffer.
  const skipSubBlocks = (): boolean => {
    while (pos < buf.length) {
      const size = buf[pos] as number;
      pos += 1 + size;
      if (size === 0) return true;
    }
    return false;
  };

  let frames = 0;
  while (pos < buf.length) {
    const block = buf[pos];
    if (block === 0x3b) break; // trailer
    if (block === 0x21) {
      pos += 2; // introducer + label
      if (!skipSubBlocks()) return null;
    } else if (block === 0x2c) {
      frames += 1;
      if (frames > MAX_IMAGE_FRAMES) break; // already over; stop walking
      if (pos + 10 > buf.length) return null;
      const left = buf.readUInt16LE(pos + 1);
      const top = buf.readUInt16LE(pos + 3);
      const frameWidth = buf.readUInt16LE(pos + 5);
      const frameHeight = buf.readUInt16LE(pos + 7);
      width = Math.max(width, left + frameWidth);
      height = Math.max(height, top + frameHeight);
      const imageFlags = buf[pos + 9] as number;
      pos += 10;
      if (imageFlags & 0x80) pos += 3 * 2 ** ((imageFlags & 0x07) + 1);
      pos += 1; // LZW minimum code size
      if (pos > buf.length || !skipSubBlocks()) return null;
    } else {
      return null; // malformed block stream
    }
  }
  return { width, height, frames };
}

function parseWebp(buf: Buffer): ImageInfo | null {
  let width = 0;
  let height = 0;
  let frames = 0;
  let sawDimensions = false;
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const type = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const data = pos + 8;
    if (type === "VP8X" && data + 10 <= buf.length) {
      width = buf.readUIntLE(data + 4, 3) + 1;
      height = buf.readUIntLE(data + 7, 3) + 1;
      sawDimensions = true;
    } else if (type === "VP8 " && !sawDimensions && data + 10 <= buf.length) {
      if (buf[data + 3] !== 0x9d || buf[data + 4] !== 0x01) return null;
      width = buf.readUInt16LE(data + 6) & 0x3fff;
      height = buf.readUInt16LE(data + 8) & 0x3fff;
      sawDimensions = true;
    } else if (type === "VP8L" && !sawDimensions && data + 5 <= buf.length) {
      if (buf[data] !== 0x2f) return null;
      const bits = buf.readUInt32LE(data + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
      sawDimensions = true;
    } else if (type === "ANMF") {
      frames += 1;
      if (frames > MAX_IMAGE_FRAMES) break;
    }
    pos = data + size + (size & 1);
  }
  if (!sawDimensions) return null;
  return { width, height, frames: Math.max(frames, 1) };
}

/**
 * Parse container headers and enforce dimension, pixel and frame bounds.
 * Never decodes pixel data; work is linear in the buffer length at most.
 */
export function checkImageBounds(
  buffer: Buffer,
  mime: string,
): ImageBoundsResult {
  let info: ImageInfo | null;
  switch (mime) {
    case "image/png":
      info = parsePng(buffer);
      break;
    case "image/jpeg":
      info = parseJpeg(buffer);
      break;
    case "image/gif":
      info = parseGif(buffer);
      break;
    case "image/webp":
      info = parseWebp(buffer);
      break;
    default:
      return fail("Unsupported image format");
  }

  if (!info) return fail("Image dimensions could not be determined");
  const { width, height, frames } = info;
  if (width < 1 || height < 1) return fail("Image has zero dimensions");
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE) {
    return fail(`Image dimensions exceed ${MAX_IMAGE_EDGE}px per side`);
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    return fail(
      `Image exceeds the ${MAX_IMAGE_PIXELS / 1_000_000} megapixel limit`,
    );
  }
  if (frames > MAX_IMAGE_FRAMES) {
    return fail(`Image exceeds the ${MAX_IMAGE_FRAMES} frame limit`);
  }
  if (width * height * frames > MAX_IMAGE_TOTAL_PIXELS) {
    return fail("Animated image decoded size exceeds the allowed limit");
  }
  return { ok: true, info };
}
