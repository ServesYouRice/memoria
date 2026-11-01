import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { projectRoot, run } from './lib/runtime.mjs';

// SERVER_BUNDLE_OUT_DIR lets tests build the bundles outside dist/.
const distDir = process.env.SERVER_BUNDLE_OUT_DIR
  ? resolve(process.env.SERVER_BUNDLE_OUT_DIR)
  : join(projectRoot, 'dist');

// Locate the native esbuild binary for the current platform inside pnpm's
// store (works on any OS/arch without relying on postinstall bin shims).
function platformEsbuildCandidates() {
  const pkg = `${process.platform}-${process.arch}`;
  const binName = process.platform === 'win32' ? 'esbuild.exe' : join('bin', 'esbuild');
  const pnpmDir = join(projectRoot, 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) return [];
  return readdirSync(pnpmDir)
    .filter((entry) => entry.startsWith(`@esbuild+${pkg}@`))
    .sort()
    .reverse()
    .map((entry) => join(pnpmDir, entry, 'node_modules', '@esbuild', pkg, binName));
}

const esbuildCandidates = [
  ...platformEsbuildCandidates(),
  // Fallbacks: bin shims created by package managers
  join(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.CMD' : 'esbuild'),
  join(projectRoot, 'node_modules', '.bin', 'esbuild.cmd'),
  join(projectRoot, 'node_modules', '.pnpm', 'node_modules', '.bin', 'esbuild.CMD'),
  join(projectRoot, 'node_modules', '.pnpm', 'node_modules', '.bin', 'esbuild.cmd'),
];

const esbuildBinary = esbuildCandidates.find((candidate) => existsSync(candidate));

if (!esbuildBinary) {
  throw new Error('Unable to find an esbuild binary in node_modules.');
}

mkdirSync(distDir, { recursive: true });

for (const [entrypoint, output] of [
  ['server.ts', 'server.mjs'],
  [join('scripts', 'outbox-worker.ts'), 'outbox-worker.mjs'],
  [join('scripts', 'sync-server.ts'), 'sync-server.mjs'],
]) {
  await run(
    esbuildBinary,
    [
      join(projectRoot, entrypoint),
      '--bundle',
      '--platform=node',
      '--format=esm',
      '--packages=external',
      // Packages stay external, so Node's ESM loader resolves them at start.
      // next ships no `exports` map: `next/server` (src/lib/errors.ts) only
      // resolves with its file name.
      '--alias:next/server=next/server.js',
      `--outfile=${join(distDir, output)}`,
      `--tsconfig=${join(projectRoot, 'tsconfig.json')}`,
    ],
    { cwd: projectRoot }
  );
}
