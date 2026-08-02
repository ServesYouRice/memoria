import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { projectRoot, run } from './lib/runtime.mjs';

const distDir = join(projectRoot, 'dist');

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
]) {
  await run(
    esbuildBinary,
    [
      join(projectRoot, entrypoint),
      '--bundle',
      '--platform=node',
      '--format=esm',
      '--packages=external',
      `--outfile=${join(distDir, output)}`,
      `--tsconfig=${join(projectRoot, 'tsconfig.json')}`,
    ],
    { cwd: projectRoot }
  );
}
