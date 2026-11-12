#!/usr/bin/env node
// Build store-ready packages of the Memoria browser button (IMP-093):
// dist/browser-extension/memoria-chrome-<version>.zip (Chrome Web Store and
// Edge Add-ons) and memoria-firefox-<version>.zip (addons.mozilla.org).
// Each package gets a manifest with only the keys that browser reads.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "integrations/browser-extension");
const outDir = path.join(root, "dist/browser-extension");

/** Files the extension runs; README and tests stay out of the package. */
const PACKAGED = /\.(js|html|css|png)$/;

export function manifestFor(browser, manifest) {
  const copy = structuredClone(manifest);
  if (browser === "chrome") {
    delete copy.browser_specific_settings;
    copy.background = {
      service_worker: manifest.background.service_worker,
      type: manifest.background.type,
    };
  } else {
    copy.background = {
      scripts: manifest.background.scripts,
      type: manifest.background.type,
    };
  }
  return copy;
}

function listFiles(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        return listFiles(path.join(dir, entry.name), relative);
      }
      return PACKAGED.test(entry.name) ? [relative] : [];
    })
    .sort();
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A plain zip archive (deflate, no extra fields) of [name, Buffer] pairs. */
export function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  // A fixed timestamp (1 Jan 2026) keeps builds byte-for-byte repeatable.
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const [name, data] of entries) {
    const fileName = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    locals.push(local, fileName, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, fileName);
    offset += local.length + fileName.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

export function buildPackages() {
  const manifest = JSON.parse(
    readFileSync(path.join(source, "manifest.json"), "utf8"),
  );
  const files = listFiles(source).map((name) => [
    name,
    readFileSync(path.join(source, name)),
  ]);
  mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const browser of ["chrome", "firefox"]) {
    const archive = zip([
      [
        "manifest.json",
        Buffer.from(
          `${JSON.stringify(manifestFor(browser, manifest), null, 2)}\n`,
        ),
      ],
      ...files,
    ]);
    const file = path.join(
      outDir,
      `memoria-${browser}-${manifest.version}.zip`,
    );
    writeFileSync(file, archive);
    written.push(path.relative(root, file));
  }
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const file of buildPackages()) console.log(`Built ${file}`);
}
