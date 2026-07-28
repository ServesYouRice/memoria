import { spawnSync } from 'child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
const parsed = new URL(databaseUrl);
if (!parsed.pathname.toLowerCase().includes('test')) {
  throw new Error('Refusing to reset a database whose name does not contain "test"');
}

const command = process.execPath;
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error('Run this script through pnpm test:integration');
const env = { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' };
for (const args of [
  ['exec', 'prisma', 'migrate', 'reset', '--force', '--skip-seed'],
  ['exec', 'node', 'scripts/check-schema-drift.mjs'],
  ['exec', 'vitest', '--run', '--config', 'vitest.integration.config.ts'],
]) {
  const result = spawnSync(command, [pnpmCli, ...args], {
    stdio: 'inherit',
    env,
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
