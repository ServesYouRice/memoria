import { getPnpmCommand, projectRoot, run } from './lib/runtime.mjs';

const pnpm = getPnpmCommand();

await run('node', ['scripts/validate-env.mjs'], {
  cwd: projectRoot,
  env: { ...process.env, MEMORIA_BUILD_PHASE: 'true' },
});
await run(pnpm, ['exec', 'next', 'build', '--webpack'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    MEMORIA_SKIP_DB_EAGER_CONNECT: 'true',
    MEMORIA_BUILD_PHASE: 'true',
  },
});
await run('node', ['scripts/build-server.mjs'], { cwd: projectRoot });
