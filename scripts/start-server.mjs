import { existsSync } from 'fs';
import { join } from 'path';
import { projectRoot, run } from './lib/runtime.mjs';

const compiledServer = join(projectRoot, 'dist', 'server.mjs');

if (!existsSync(compiledServer)) {
  throw new Error('Missing compiled server bundle at dist/server.mjs. Run `pnpm build` first.');
}

await run('node', ['dist/server.mjs'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'production',
  },
});
