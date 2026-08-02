import { existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { projectRoot } from './lib/runtime.mjs';

const compiledWorker = join(projectRoot, 'dist', 'outbox-worker.mjs');

if (!existsSync(compiledWorker)) {
  throw new Error('Missing compiled outbox worker at dist/outbox-worker.mjs. Run `pnpm build` first.');
}

process.env.NODE_ENV ||= 'production';
await import(pathToFileURL(compiledWorker).href);
