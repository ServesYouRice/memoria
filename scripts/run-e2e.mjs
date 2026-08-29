import { createWriteStream, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { getDockerCommand, getPnpmCommand, projectRoot, run } from './lib/runtime.mjs';

const docker = getDockerCommand();
const pnpm = getPnpmCommand();
const projectName = process.env.MEMORIA_E2E_PROJECT || 'memoria-e2e';
const image = process.env.MEMORIA_E2E_IMAGE || 'memoria:e2e';
const composeFile = join(projectRoot, 'docker-compose.e2e.yml');
const artifactsDir = join(projectRoot, 'test-results', 'services');
const keepServices = process.argv.includes('--keep');
const skipImageBuild =
  process.env.E2E_SKIP_IMAGE_BUILD === '1' || process.argv.includes('--skip-image-build');
const harnessArgs = new Set(['--keep', '--skip-image-build']);
const playwrightArgs = process.argv.slice(2).filter((argument) => !harnessArgs.has(argument));
const composeArgs = ['compose', '-p', projectName, '-f', composeFile];
const runtimeEnv = {
  ...process.env,
  MEMORIA_E2E_IMAGE: image,
  BASE_URL: 'http://127.0.0.1:3300',
  OPERATIONS_BASE_URL: 'http://127.0.0.1:3302',
  E2E_EXTERNAL_SERVER: '1',
  E2E_EMAIL_CAPTURE_URL: 'http://127.0.0.1:38025',
  E2E_EMAIL_CAPTURE_TOKEN: 'memoria-e2e-email-capture-token',
  INTERNAL_OPERATIONS_TOKEN: 'memoria-e2e-operations-token-0123456789abcdef',
  AUTH_URL: 'http://127.0.0.1:3300',
};

mkdirSync(artifactsDir, { recursive: true });

async function captureComposeLogs() {
  const output = createWriteStream(join(artifactsDir, 'compose.log'), { flags: 'w' });
  await new Promise((resolvePromise) => {
    const child = spawn(docker, [...composeArgs, 'logs', '--no-color', '--timestamps'], {
      cwd: projectRoot,
      env: runtimeEnv,
      shell: process.platform === 'win32',
    });
    child.stdout.pipe(output);
    child.stderr.pipe(output);
    child.once('close', () => {
      output.end();
      resolvePromise();
    });
    child.once('error', () => {
      output.end();
      resolvePromise();
    });
  });
}

let failure;
try {
  if (!skipImageBuild) {
    await run(docker, ['build', '--tag', image, '.'], { cwd: projectRoot, env: runtimeEnv });
  }
  await run(
    docker,
    [...composeArgs, 'up', '-d', '--wait', '--wait-timeout', '240'],
    { cwd: projectRoot, env: runtimeEnv },
  );
  await run(pnpm, ['exec', 'playwright', 'test', ...playwrightArgs], {
    cwd: projectRoot,
    env: runtimeEnv,
  });
  await run('node', ['scripts/smoke.mjs', '--strict', '--json'], {
    cwd: projectRoot,
    env: runtimeEnv,
  });
} catch (error) {
  failure = error;
} finally {
  await captureComposeLogs();
  if (!keepServices) {
    try {
      await run(docker, [...composeArgs, 'down', '--volumes', '--remove-orphans'], {
        cwd: projectRoot,
        env: runtimeEnv,
      });
    } catch (cleanupError) {
      failure ||= cleanupError;
    }
  }
}

if (failure) throw failure;
