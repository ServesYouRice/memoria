import { existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { projectRoot } from './lib/runtime.mjs';

const compiledSyncServer = join(projectRoot, 'dist', 'sync-server.mjs');

if (!existsSync(compiledSyncServer)) {
  throw new Error('Missing compiled sync server at dist/sync-server.mjs. Run `pnpm build` first.');
}

process.env.NODE_ENV ||= 'production';
await import(pathToFileURL(compiledSyncServer).href);
