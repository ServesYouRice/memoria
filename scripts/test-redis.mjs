// Runs tests/redis against a real Valkey whose app user carries the shared
// cluster's ACL (IMP-073): keys and channels only under "memoria:", no
// @admin or @dangerous commands except INFO. Starts a throwaway container on a
// random loopback port unless REDIS_ACL_TEST_URL and REDIS_ACL_ADMIN_URL
// already name a server set up that way.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { getDockerCommand } from './lib/runtime.mjs';

const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error('Run this script through pnpm test:redis');

// Mirrors the memoria line in the infra repo's platform/valkey users.acl.
const APP_ACL = [
  'resetkeys',
  '~memoria:*',
  'resetchannels',
  '&memoria:*',
  '+@all',
  '-@admin',
  '-@dangerous',
  '+info',
];

const docker = getDockerCommand();
const image = process.env.MEMORIA_REDIS_TEST_IMAGE || 'valkey/valkey:9.1.3-alpine';

function dockerRun(args, { allowFailure = false } = {}) {
  const result = spawnSync(docker, args, { encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`docker ${args[0]} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

async function startServer() {
  const name = `memoria-redis-acl-${randomBytes(4).toString('hex')}`;
  const adminPassword = randomBytes(16).toString('hex');
  const appPassword = randomBytes(16).toString('hex');
  dockerRun([
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--publish',
    '127.0.0.1::6379',
    image,
    'redis-server',
    '--save',
    '',
    '--appendonly',
    'no',
    '--user',
    'default',
    'off',
    '--user',
    'admin',
    'on',
    `>${adminPassword}`,
    '~*',
    '&*',
    '+@all',
    '--user',
    'memoria',
    'on',
    `>${appPassword}`,
    ...APP_ACL,
  ]);
  const stop = () => dockerRun(['rm', '--force', name], { allowFailure: true });
  try {
    const port = dockerRun(['port', name, '6379/tcp'])
      .stdout.trim()
      .split('\n')[0]
      .split(':')
      .pop();
    const deadline = Date.now() + 30_000;
    for (;;) {
      const ping = dockerRun(
        [
          'exec',
          name,
          'redis-cli',
          '--no-auth-warning',
          '--user',
          'admin',
          '--pass',
          adminPassword,
          'ping',
        ],
        { allowFailure: true },
      );
      if (ping.stdout.trim() === 'PONG') break;
      if (Date.now() > deadline) throw new Error(`${name} did not answer PING`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
    return {
      appUrl: `redis://memoria:${appPassword}@127.0.0.1:${port}`,
      adminUrl: `redis://admin:${adminPassword}@127.0.0.1:${port}`,
      stop,
    };
  } catch (error) {
    stop();
    throw error;
  }
}

const external = process.env.REDIS_ACL_TEST_URL && process.env.REDIS_ACL_ADMIN_URL;
const server = external
  ? {
      appUrl: process.env.REDIS_ACL_TEST_URL,
      adminUrl: process.env.REDIS_ACL_ADMIN_URL,
      stop: () => {},
    }
  : await startServer();

let status = 1;
try {
  const result = spawnSync(
    process.execPath,
    [pnpmCli, 'exec', 'vitest', '--run', '--config', 'vitest.redis.config.ts', ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        REDIS_ACL_TEST_URL: server.appUrl,
        REDIS_ACL_ADMIN_URL: server.adminUrl,
      },
    },
  );
  status = result.status ?? 1;
} finally {
  server.stop();
}
process.exit(status);
