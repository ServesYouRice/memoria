import {
  defaultEnvFile,
  ensureEnvFile,
  ensureS3Bucket,
  getDockerCommand,
  getPnpmCommand,
  parseArgs,
  parseConnectionTarget,
  printSection,
  projectRoot,
  randomSecret,
  readEnvFile,
  run,
  selfHostEnvFile,
  upsertEnvValue,
  waitForPort,
  writeEnvFile,
} from './lib/runtime.mjs';
import { runSmokeChecks } from './lib/smoke.mjs';

const pnpm = getPnpmCommand();
const docker = getDockerCommand();
const { values, flags } = parseArgs(process.argv.slice(2));
const mode = values[0] || 'dev';
const force = flags.has('--force');
const seed = flags.has('--seed');

function prepareEnv(targetPath, targetMode) {
  let raw = ensureEnvFile(targetPath, { force });
  const currentValues = readEnvFile(targetPath).values;
  const isProduction = targetMode === 'selfhost';
  const databasePassword = currentValues.get('DATABASE_PASSWORD') || randomSecret(18);
  const authSecret = currentValues.get('AUTH_SECRET') || currentValues.get('NEXTAUTH_SECRET') || randomSecret(32);
  const bootstrapToken = currentValues.get('APP_BOOTSTRAP_TOKEN') || randomSecret(24);
  const minioPassword = currentValues.get('S3_SECRET_ACCESS_KEY') || currentValues.get('MINIO_ROOT_PASSWORD') || randomSecret(18);
  const appUrl = 'http://localhost:3000';
  const bucket = currentValues.get('S3_BUCKET') || 'memoria-uploads';

  raw = upsertEnvValue(raw, 'NODE_ENV', isProduction ? 'production' : 'development');
  raw = upsertEnvValue(raw, 'DATABASE_PASSWORD', databasePassword);
  raw = upsertEnvValue(
    raw,
    'DATABASE_URL',
    targetMode === 'selfhost'
      ? `postgresql://canvascollect:${databasePassword}@postgres:5432/canvascollect`
      : `postgresql://canvascollect:${databasePassword}@localhost:5432/canvascollect`
  );
  raw = upsertEnvValue(raw, 'REDIS_URL', targetMode === 'selfhost' ? 'redis://redis:6379' : 'redis://localhost:6379');
  raw = upsertEnvValue(raw, 'AUTH_URL', appUrl);
  raw = upsertEnvValue(raw, 'NEXTAUTH_URL', appUrl);
  raw = upsertEnvValue(raw, 'AUTH_SECRET', authSecret);
  raw = upsertEnvValue(raw, 'NEXTAUTH_SECRET', authSecret);
  raw = upsertEnvValue(raw, 'APP_BOOTSTRAP_TOKEN', bootstrapToken);
  raw = upsertEnvValue(raw, 'EMAIL_PROVIDER', 'console');
  raw = upsertEnvValue(raw, 'UPLOAD_STORAGE', 's3');
  raw = upsertEnvValue(raw, 'S3_BUCKET', bucket);
  raw = upsertEnvValue(raw, 'S3_REGION', 'us-east-1');
  raw = upsertEnvValue(raw, 'S3_ENDPOINT', targetMode === 'selfhost' ? 'http://minio:9000' : 'http://localhost:9000');
  raw = upsertEnvValue(raw, 'UPLOADS_PUBLIC_URL', 'http://localhost:9000/memoria-uploads');
  raw = upsertEnvValue(raw, 'S3_ACCESS_KEY_ID', 'minioadmin');
  raw = upsertEnvValue(raw, 'S3_SECRET_ACCESS_KEY', minioPassword);
  raw = upsertEnvValue(raw, 'MINIO_ROOT_USER', 'minioadmin');
  raw = upsertEnvValue(raw, 'MINIO_ROOT_PASSWORD', minioPassword);
  raw = upsertEnvValue(raw, 'SMTP_PASS', '');

  writeEnvFile(targetPath, raw);
  return { bootstrapToken, bucket };
}

async function waitForInfrastructure(envValues) {
  const databaseTarget = parseConnectionTarget(envValues.get('DATABASE_URL'), 5432);
  const redisTarget = parseConnectionTarget(envValues.get('REDIS_URL'), 6379);

  await waitForPort({ ...databaseTarget, label: 'Postgres' });
  await waitForPort({ ...redisTarget, label: 'Redis' });
  await waitForPort({ host: '127.0.0.1', port: 9000, label: 'MinIO API' });
}

if (!['dev', 'selfhost'].includes(mode)) {
  throw new Error('Usage: node scripts/setup.mjs <dev|selfhost> [--seed] [--force]');
}

const envPath = mode === 'selfhost' ? selfHostEnvFile : defaultEnvFile;
const { bootstrapToken, bucket } = prepareEnv(envPath, mode);
const envValues = readEnvFile(envPath).values;
const composeArgs = ['compose', '--env-file', envPath, '-f', 'docker-compose.yml'];

if (mode === 'dev') {
  await run(docker, [...composeArgs, 'up', '-d', 'postgres', 'redis', 'minio'], { cwd: projectRoot });
  await waitForInfrastructure(envValues);
  await ensureS3Bucket({
    endpoint: envValues.get('S3_ENDPOINT'),
    region: envValues.get('S3_REGION'),
    accessKeyId: envValues.get('S3_ACCESS_KEY_ID'),
    secretAccessKey: envValues.get('S3_SECRET_ACCESS_KEY'),
    bucket,
    createIfMissing: true,
  });

  await run(pnpm, ['install'], { cwd: projectRoot });
  await run(pnpm, ['db:generate'], {
    cwd: projectRoot,
    env: { ...process.env, MEMORIA_ENV_FILE: envPath },
  });
  await run(pnpm, ['db:migrate:dev', '--name', 'setup'], {
    cwd: projectRoot,
    env: { ...process.env, MEMORIA_ENV_FILE: envPath },
  });

  if (seed) {
    await run(pnpm, ['db:seed'], {
      cwd: projectRoot,
      env: { ...process.env, MEMORIA_ENV_FILE: envPath },
    });
  }

  printSection('Development Setup Complete', [
    `Environment file: ${envPath}`,
    'App URL: http://localhost:3000',
    'MinIO Console: http://localhost:9001',
    'Next command: pnpm dev',
  ]);
} else {
  await run(docker, [...composeArgs, 'up', '-d', '--build'], { cwd: projectRoot });
  await waitForInfrastructure(envValues);
  await waitForPort({ host: '127.0.0.1', port: 3000, label: 'App' });
  await ensureS3Bucket({
    endpoint: 'http://localhost:9000',
    region: envValues.get('S3_REGION'),
    accessKeyId: envValues.get('S3_ACCESS_KEY_ID'),
    secretAccessKey: envValues.get('S3_SECRET_ACCESS_KEY'),
    bucket,
    createIfMissing: true,
  });

  await run(docker, [...composeArgs, 'exec', '-T', 'app', 'pnpm', 'db:migrate'], { cwd: projectRoot });
  const smokeReport = await runSmokeChecks({
    baseUrl: envValues.get('AUTH_URL') || 'http://localhost:3000',
    requireRunningApp: true,
  });

  if (smokeReport.hasFailure) {
    throw new Error(
      `Self-host smoke checks failed: ${smokeReport.results
        .filter((result) => result.status === 'fail')
        .map((result) => `${result.name}: ${result.detail}`)
        .join('; ')}`
    );
  }

  printSection('Self-Host Setup Complete', [
    `Environment file: ${envPath}`,
    'App URL: http://localhost:3000',
    `Bootstrap URL: http://localhost:3000/setup?token=${bootstrapToken}`,
    'MinIO Console: http://localhost:9001',
    'Smoke checks: passed',
  ]);
}
