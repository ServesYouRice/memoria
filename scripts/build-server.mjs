import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { projectRoot, run } from './lib/runtime.mjs';

const distDir = join(projectRoot, 'dist');
const esbuildCandidates = [
  join(projectRoot, 'node_modules', '.pnpm', '@esbuild+win32-x64@0.25.12', 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe'),
  join(projectRoot, 'node_modules', '.pnpm', '@esbuild+win32-x64@0.21.5', 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe'),
  join(projectRoot, 'node_modules', '.bin', 'esbuild.CMD'),
  join(projectRoot, 'node_modules', '.bin', 'esbuild.cmd'),
  join(projectRoot, 'node_modules', '.pnpm', 'node_modules', '.bin', 'esbuild.CMD'),
  join(projectRoot, 'node_modules', '.pnpm', 'node_modules', '.bin', 'esbuild.cmd'),
];

const esbuildBinary = esbuildCandidates.find((candidate) => existsSync(candidate));

if (!esbuildBinary) {
  throw new Error('Unable to find an esbuild binary in node_modules.');
}

mkdirSync(distDir, { recursive: true });

await run(
  esbuildBinary,
  [
    join(projectRoot, 'server.ts'),
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--packages=external',
    `--outfile=${join(distDir, 'server.mjs')}`,
    `--tsconfig=${join(projectRoot, 'tsconfig.json')}`,
  ],
  { cwd: projectRoot }
);
