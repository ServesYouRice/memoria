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

function usableSecret(value, minLength = 24) {
  return (
    typeof value === 'string' &&
    value.length >= minLength &&
    !/replace-me|devpassword|minioadmin/i.test(value)
  );
}

function getSelfHostChoices() {
  const publicUrl = process.env.MEMORIA_PUBLIC_URL;
  const emailProvider = process.env.EMAIL_PROVIDER;
  if (!publicUrl || !/^https:\/\//i.test(publicUrl)) {
    throw new Error('Set MEMORIA_PUBLIC_URL to the public HTTPS origin before self-host setup.');
  }
  if (emailProvider !== 'sendgrid' && emailProvider !== 'resend') {
    throw new Error('Set EMAIL_PROVIDER to sendgrid or resend before self-host setup.');
  }
  const providerKey =
    emailProvider === 'sendgrid' ? process.env.SENDGRID_API_KEY : process.env.RESEND_API_KEY;
  if (!providerKey) {
    throw new Error(`Set ${emailProvider === 'sendgrid' ? 'SENDGRID_API_KEY' : 'RESEND_API_KEY'} before self-host setup.`);
  }
  return { publicUrl: publicUrl.replace(/\/$/, ''), emailProvider, providerKey };
}

function prepareEnv(targetPath, targetMode, selfHostChoices) {
  let raw = ensureEnvFile(targetPath, { force });
  const currentValues = readEnvFile(targetPath).values;
  const isProduction = targetMode === 'selfhost';
  const existingDatabasePassword = currentValues.get('DATABASE_PASSWORD');
  const existingAuthSecret = currentValues.get('AUTH_SECRET') || currentValues.get('NEXTAUTH_SECRET');
  const existingBootstrapToken = currentValues.get('APP_BOOTSTRAP_TOKEN');
  const existingMinioPassword = currentValues.get('S3_SECRET_ACCESS_KEY') || currentValues.get('MINIO_ROOT_PASSWORD');
  const databasePassword = usableSecret(existingDatabasePassword, 18) ? existingDatabasePassword : randomSecret(24);
  const authSecret = usableSecret(existingAuthSecret, 32) ? existingAuthSecret : randomSecret(48);
  const bootstrapToken = usableSecret(existingBootstrapToken, 24) ? existingBootstrapToken : randomSecret(32);
  const minioPassword = usableSecret(existingMinioPassword, 24) ? existingMinioPassword : randomSecret(32);
  const redisPassword = usableSecret(currentValues.get('REDIS_PASSWORD'), 24)
    ? currentValues.get('REDIS_PASSWORD')
    : randomSecret(32);
  const minioUser = usableSecret(currentValues.get('MINIO_ROOT_USER'), 16)
    ? currentValues.get('MINIO_ROOT_USER')
    : `memoria-${randomSecret(12)}`;
  const modelCredentialKey = usableSecret(currentValues.get('MODEL_CREDENTIAL_ENCRYPTION_KEY'), 32)
    ? currentValues.get('MODEL_CREDENTIAL_ENCRYPTION_KEY')
    : randomSecret(48);
  const cronSecret = usableSecret(currentValues.get('CRON_SECRET'), 24)
    ? currentValues.get('CRON_SECRET')
    : randomSecret(32);
  const appUrl = selfHostChoices?.publicUrl || 'http://localhost:3000';
  const bucket = currentValues.get('S3_BUCKET') || 'memoria-uploads';

  raw = upsertEnvValue(raw, 'NODE_ENV', isProduction ? 'production' : 'development');
  raw = upsertEnvValue(raw, 'DATABASE_PASSWORD', databasePassword);
  raw = upsertEnvValue(
    raw,
    'DATABASE_URL',
    targetMode === 'selfhost'
      ? `postgresql://memoria:${databasePassword}@postgres:5432/memoria`
      : `postgresql://memoria:${databasePassword}@localhost:5432/memoria`
  );
  raw = upsertEnvValue(raw, 'REDIS_PASSWORD', redisPassword);
  raw = upsertEnvValue(
    raw,
    'REDIS_URL',
    targetMode === 'selfhost'
      ? `redis://:${redisPassword}@redis:6379`
      : `redis://:${redisPassword}@localhost:6379`
  );
  raw = upsertEnvValue(raw, 'AUTH_URL', appUrl);
  raw = upsertEnvValue(raw, 'NEXTAUTH_URL', appUrl);
  raw = upsertEnvValue(raw, 'AUTH_SECRET', authSecret);
  raw = upsertEnvValue(raw, 'NEXTAUTH_SECRET', authSecret);
  raw = upsertEnvValue(raw, 'APP_BOOTSTRAP_TOKEN', bootstrapToken);
  raw = upsertEnvValue(raw, 'EMAIL_PROVIDER', selfHostChoices?.emailProvider || 'console');
  if (selfHostChoices?.emailProvider === 'sendgrid') {
    raw = upsertEnvValue(raw, 'SENDGRID_API_KEY', selfHostChoices.providerKey);
  }
  if (selfHostChoices?.emailProvider === 'resend') {
    raw = upsertEnvValue(raw, 'RESEND_API_KEY', selfHostChoices.providerKey);
  }
  raw = upsertEnvValue(raw, 'MODEL_CREDENTIAL_ENCRYPTION_KEY', modelCredentialKey);
  raw = upsertEnvValue(raw, 'CRON_SECRET', cronSecret);
  raw = upsertEnvValue(raw, 'UPLOAD_STORAGE', 's3');
  raw = upsertEnvValue(raw, 'S3_BUCKET', bucket);
  raw = upsertEnvValue(raw, 'S3_REGION', 'us-east-1');
  raw = upsertEnvValue(raw, 'S3_ENDPOINT', targetMode === 'selfhost' ? 'http://minio:9000' : 'http://localhost:9000');
  raw = upsertEnvValue(raw, 'UPLOADS_PUBLIC_URL', '');
  raw = upsertEnvValue(raw, 'S3_ACCESS_KEY_ID', minioUser);
  raw = upsertEnvValue(raw, 'S3_SECRET_ACCESS_KEY', minioPassword);
  raw = upsertEnvValue(raw, 'MINIO_ROOT_USER', minioUser);
  raw = upsertEnvValue(raw, 'MINIO_ROOT_PASSWORD', minioPassword);
  raw = upsertEnvValue(raw, 'SMTP_PASS', '');

  writeEnvFile(targetPath, raw);
  return { bootstrapToken, bucket };
}

async function waitForInfrastructure(envValues, fromHost = false) {
  const databaseTarget = fromHost
    ? { host: '127.0.0.1', port: 5432 }
    : parseConnectionTarget(envValues.get('DATABASE_URL'), 5432);
  const redisTarget = fromHost
    ? { host: '127.0.0.1', port: 6379 }
    : parseConnectionTarget(envValues.get('REDIS_URL'), 6379);

  await waitForPort({ ...databaseTarget, label: 'Postgres' });
  await waitForPort({ ...redisTarget, label: 'Redis' });
  await waitForPort({ host: '127.0.0.1', port: 9000, label: 'MinIO API' });
}

if (!['dev', 'selfhost'].includes(mode)) {
  throw new Error('Usage: node scripts/setup.mjs <dev|selfhost> [--seed] [--force]');
}

const envPath = mode === 'selfhost' ? selfHostEnvFile : defaultEnvFile;
const selfHostChoices = mode === 'selfhost' ? getSelfHostChoices() : null;
const { bootstrapToken, bucket } = prepareEnv(envPath, mode, selfHostChoices);
const envValues = readEnvFile(envPath).values;
const composeArgs = ['compose', '--env-file', envPath, '-f', 'docker-compose.yml'];

if (mode === 'dev') {
  await run(docker, [...composeArgs, 'up', '-d', 'postgres', 'redis', 'minio'], { cwd: projectRoot });
  await waitForInfrastructure(envValues, true);
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
  await waitForInfrastructure(envValues, true);
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
    baseUrl: 'http://127.0.0.1:3000',
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
    `App URL: ${selfHostChoices.publicUrl}`,
    'Bootstrap path: /setup',
    `Bootstrap token (store securely; shown once): ${bootstrapToken}`,
    'MinIO Console: bound to http://127.0.0.1:9001',
    'Smoke checks: passed',
  ]);
}
