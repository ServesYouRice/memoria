import { existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { projectRoot } from './lib/runtime.mjs';

const compiledServer = join(projectRoot, 'dist', 'server.mjs');

if (!existsSync(compiledServer)) {
  throw new Error('Missing compiled server bundle at dist/server.mjs. Run `pnpm build` first.');
}

process.env.NODE_ENV ||= 'production';
await import(pathToFileURL(compiledServer).href);
