/**
 * Upload content types, identified from magic bytes rather than the
 * client-supplied type or filename.
 *
 * Images are accepted for every upload. Audio is accepted only for voice
 * notes (IMP-071): the canvas has no audio item, so an audio upload exists to
 * be transcribed into a note that links back to it.
 */

export type UploadKind = "image" | "audio";

export interface DetectedUploadType {
  kind: UploadKind;
  mime: string;
  extension: string;
}

// NOTE: SVG is not accepted (it can carry embedded scripts).
export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export const ALLOWED_AUDIO_MIME_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
] as const;

/**
 * Client-declared types that name the same container as the detected type.
 * Browsers label MediaRecorder output and saved recordings inconsistently.
 */
const DECLARED_ALIASES: Record<string, string[]> = {
  "audio/webm": ["audio/webm", "video/webm"],
  "audio/ogg": ["audio/ogg", "application/ogg", "audio/opus"],
  "audio/mp4": ["audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac"],
  "audio/mpeg": ["audio/mpeg", "audio/mp3"],
  "audio/wav": ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"],
};

const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
  "avif",
  "avis",
]);

function ascii(buffer: Uint8Array, start: number, end: number): string {
  return Buffer.from(buffer.subarray(start, end)).toString("ascii");
}

export function detectUploadType(
  buffer: Uint8Array,
): DetectedUploadType | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { kind: "image", mime: "image/jpeg", extension: ".jpg" };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { kind: "image", mime: "image/png", extension: ".png" };
  }
  const header = ascii(buffer, 0, 6);
  if (header === "GIF87a" || header === "GIF89a") {
    return { kind: "image", mime: "image/gif", extension: ".gif" };
  }
  const riff = ascii(buffer, 0, 4);
  const riffType = ascii(buffer, 8, 12);
  if (riff === "RIFF" && riffType === "WEBP") {
    return { kind: "image", mime: "image/webp", extension: ".webp" };
  }

  // WAV: RIFF....WAVE
  if (riff === "RIFF" && riffType === "WAVE") {
    return { kind: "audio", mime: "audio/wav", extension: ".wav" };
  }
  // WebM / Matroska (Chrome and Firefox MediaRecorder): 1A 45 DF A3
  if (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return { kind: "audio", mime: "audio/webm", extension: ".webm" };
  }
  // Ogg (Firefox MediaRecorder, Opus/Vorbis files)
  if (riff === "OggS") {
    return { kind: "audio", mime: "audio/ogg", extension: ".ogg" };
  }
  // ISO BMFF (Safari MediaRecorder, iPhone voice memos): ....ftyp
  // HEIF/AVIF images share the container and are not accepted.
  if (
    ascii(buffer, 4, 8) === "ftyp" &&
    !HEIF_BRANDS.has(ascii(buffer, 8, 12))
  ) {
    return { kind: "audio", mime: "audio/mp4", extension: ".m4a" };
  }
  // MP3: ID3 tag, or an MPEG audio frame sync (FF Ex/Fx)
  if (
    ascii(buffer, 0, 3) === "ID3" ||
    (buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0)
  ) {
    return { kind: "audio", mime: "audio/mpeg", extension: ".mp3" };
  }
  return null;
}

/**
 * True when a client-declared type (if any) agrees with the detected one.
 * Parameters such as `;codecs=opus` are ignored.
 */
export function declaredTypeMatches(
  declared: string | undefined,
  detected: DetectedUploadType,
): boolean {
  const base = declared?.split(";")[0]?.trim().toLowerCase();
  if (!base) return true;
  const accepted = DECLARED_ALIASES[detected.mime] ?? [detected.mime];
  return accepted.includes(base);
}
