// `pnpm invite` (IMP-153): the compiled command where it exists (the
// production image has no tsx), otherwise the TypeScript source.
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { projectRoot } from './lib/runtime.mjs';

const compiled = join(projectRoot, 'dist', 'create-invite.mjs');

if (existsSync(compiled)) {
  process.env.NODE_ENV ||= 'production';
  await import(pathToFileURL(compiled).href);
} else {
  const result = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'tsx', join(projectRoot, 'scripts', 'create-invite.ts'), ...process.argv.slice(2)],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
  process.exit(result.status ?? 1);
}
