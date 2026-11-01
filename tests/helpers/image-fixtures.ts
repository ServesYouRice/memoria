/**
 * Minimal header-only image fixtures. They carry valid container headers (what
 * the upload bounds check reads) but no decodable pixel data, which is exactly
 * what a decode bomb looks like to a header parser.
 */

function u32be(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value);
  return b;
}

function pngChunk(type: string, data: Buffer): Buffer {
  // CRC is not checked by the header parser.
  return Buffer.concat([
    u32be(data.length),
    Buffer.from(type, "ascii"),
    data,
    Buffer.alloc(4),
  ]);
}

export function pngBytes(
  width: number,
  height: number,
  options: { frames?: number } = {},
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const chunks = [pngChunk("IHDR", ihdr)];
  if (options.frames !== undefined) {
    const actl = Buffer.alloc(8);
    actl.writeUInt32BE(options.frames, 0);
    chunks.push(pngChunk("acTL", actl));
  }
  chunks.push(
    pngChunk("IDAT", Buffer.alloc(4)),
    pngChunk("IEND", Buffer.alloc(0)),
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ...chunks,
  ]);
}

export function jpegBytes(width: number, height: number): Buffer {
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(17, 0); // segment length
  sof[2] = 8; // precision
  sof.writeUInt16BE(height, 3);
  sof.writeUInt16BE(width, 5);
  sof[7] = 3; // components
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xc0]),
    sof,
    Buffer.from([0xff, 0xd9]),
  ]);
}

export function gifBytes(
  width: number,
  height: number,
  frames: number,
): Buffer {
  const header = Buffer.alloc(13);
  header.write("GIF89a", 0, "ascii");
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  // No global color table.
  const frame = Buffer.concat([
    Buffer.from([0x2c, 0, 0, 0, 0]),
    Buffer.from([1, 0, 1, 0, 0]), // 1x1 sub-image, no local table
    Buffer.from([2, 1, 0x44, 0]), // LZW min code size + one sub-block + end
  ]);
  return Buffer.concat([
    header,
    ...Array.from({ length: frames }, () => frame),
    Buffer.from([0x3b]),
  ]);
}

function riff(chunks: Buffer[]): Buffer {
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), ...chunks]);
  return Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    (() => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(body.length);
      return b;
    })(),
    body,
  ]);
}

function webpChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(type, 0, "ascii");
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([
    header,
    data,
    data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0),
  ]);
}

export function webpLosslessBytes(width: number, height: number): Buffer {
  const data = Buffer.alloc(10);
  data[0] = 0x2f;
  data.writeUInt32LE(
    ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14),
    1,
  );
  return riff([webpChunk("VP8L", data)]);
}

export function webpAnimatedBytes(
  width: number,
  height: number,
  frames: number,
): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x02; // animation flag
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const anmf = webpChunk("ANMF", Buffer.alloc(16));
  return riff([
    webpChunk("VP8X", vp8x),
    ...Array.from({ length: frames }, () => anmf),
  ]);
}
