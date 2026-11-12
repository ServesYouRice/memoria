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
  smallEnvFile,
  upsertEnvValue,
  waitForPort,
  writeEnvFile,
} from './lib/runtime.mjs';
import { runSmokeChecks } from './lib/smoke.mjs';
import { probeLiveConnection } from './lib/live-connection.mjs';

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
    !/replace-me|replace-with|devpassword|minioadmin/i.test(value)
  );
}

/**
 * The small set-up's own address range (docker-compose.small.yml pins it).
 * Its gateway is where the host's own TLS proxy appears to the app through
 * the loopback-only published port.
 */
const SMALL_NETWORK_GATEWAY_CIDR = '172.29.48.1/32';

function getSelfHostChoices({ small = false } = {}) {
  const publicUrl = process.env.MEMORIA_PUBLIC_URL;
  const emailProvider = process.env.EMAIL_PROVIDER;
  const emailFrom = process.env.EMAIL_FROM;
  const emailDeliveryProbeTo = process.env.EMAIL_DELIVERY_PROBE_TO;
  const backupBucket = process.env.BACKUP_BUCKET;
  const backupEndpoint = process.env.BACKUP_S3_ENDPOINT;
  const backupAccessKeyId = process.env.BACKUP_S3_ACCESS_KEY_ID;
  const backupSecretAccessKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY;
  // The small set-up may be tried on this machine first (http://localhost).
  const localTrial =
    small && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(publicUrl || '');
  if (!publicUrl || (!/^https:\/\//i.test(publicUrl) && !localTrial)) {
    throw new Error(
      small
        ? 'Set MEMORIA_PUBLIC_URL to the public HTTPS address (or http://localhost:3000 to try it on this machine) before small setup.'
        : 'Set MEMORIA_PUBLIC_URL to the public HTTPS origin before self-host setup.',
    );
  }
  if (emailProvider !== 'sendgrid' && emailProvider !== 'resend' && emailProvider !== 'smtp') {
    throw new Error('Set EMAIL_PROVIDER to sendgrid, resend, or smtp before self-host setup.');
  }
  let providerKey = '';
  let smtp = null;
  if (emailProvider === 'smtp') {
    smtp = {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_SECURE || 'false',
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    };
    const missing = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'].filter(
      (name) => !process.env[name],
    );
    if (missing.length > 0) {
      throw new Error(`Set ${missing.join(', ')} before self-host setup with EMAIL_PROVIDER=smtp.`);
    }
  } else {
    providerKey =
      emailProvider === 'sendgrid' ? process.env.SENDGRID_API_KEY : process.env.RESEND_API_KEY;
    if (!providerKey) {
      throw new Error(`Set ${emailProvider === 'sendgrid' ? 'SENDGRID_API_KEY' : 'RESEND_API_KEY'} before self-host setup.`);
    }
  }
  if (!emailFrom || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailFrom) || /\.(local|localhost)$/i.test(emailFrom.split('@')[1] || '')) {
    throw new Error('Set EMAIL_FROM to a verified sender on a publicly routable domain before self-host setup.');
  }
  if (process.env.EMAIL_SENDER_VERIFIED !== 'true') {
    throw new Error('Verify the EMAIL_FROM sender/domain with the provider, then set EMAIL_SENDER_VERIFIED=true.');
  }
  if (!emailDeliveryProbeTo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailDeliveryProbeTo)) {
    throw new Error('Set EMAIL_DELIVERY_PROBE_TO to an operator-controlled mailbox before self-host setup.');
  }
  if (!small && (!backupBucket || !backupAccessKeyId || !backupSecretAccessKey)) {
    throw new Error(
      'Set BACKUP_BUCKET and dedicated BACKUP_S3_ACCESS_KEY_ID/BACKUP_S3_SECRET_ACCESS_KEY credentials before self-host setup.',
    );
  }
  if (backupEndpoint && /(^|\/\/)(minio|localhost|127\.0\.0\.1)(:|\/|$)/i.test(backupEndpoint)) {
    throw new Error('BACKUP_S3_ENDPOINT must be an off-host destination, not the application MinIO service.');
  }
  if (process.env.BACKUP_S3_SSE === 'none') {
    throw new Error('BACKUP_S3_SSE must enable encryption for self-host production backups.');
  }
  return {
    publicUrl: publicUrl.replace(/\/$/, ''),
    emailProvider,
    providerKey,
    smtp,
    emailFrom,
    emailDeliveryProbeTo,
    backupBucket,
    backupEndpoint: backupEndpoint || '',
    backupRegion: process.env.BACKUP_S3_REGION || 'us-east-1',
    backupAccessKeyId,
    backupSecretAccessKey,
    backupSse: process.env.BACKUP_S3_SSE || 'AES256',
  };
}

async function runEmailDeliveryProbe({ operationsBaseUrl, operationsToken, timeoutMs = 60000 }) {
  const headers = { authorization: `Bearer ${operationsToken}` };
  const start = await fetch(new URL('/api/operations/email/probe', operationsBaseUrl), {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(5000),
  });
  const startPayload = await start.json().catch(() => null);
  if (start.status !== 202 || typeof startPayload?.jobId !== 'string') {
    throw new Error(`Email delivery probe could not be queued (HTTP ${start.status}).`);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const status = await fetch(
      new URL(`/api/operations/email/probe?jobId=${encodeURIComponent(startPayload.jobId)}`, operationsBaseUrl),
      { headers, signal: AbortSignal.timeout(5000) },
    );
    const payload = await status.json().catch(() => null);
    if (status.ok && payload?.status === 'COMPLETED') return startPayload.jobId;
    if (status.ok && payload?.status === 'DEAD') {
      throw new Error(`Email delivery probe failed: ${payload.lastError || 'provider rejected delivery'}`);
    }
  }

  throw new Error(`Email delivery probe ${startPayload.jobId} did not complete within ${timeoutMs}ms.`);
}

// Pinned in docker-compose.yml (networks.edge); only the gateway lives on it.
const EDGE_NETWORK_CIDR = '172.29.47.0/28';

function prepareEnv(targetPath, targetMode, selfHostChoices) {
  let raw = ensureEnvFile(targetPath, { force });
  const currentValues = readEnvFile(targetPath).values;
  const isProduction = targetMode === 'selfhost' || targetMode === 'small';
  const inContainers = isProduction;
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
  const operationsToken = usableSecret(currentValues.get('INTERNAL_OPERATIONS_TOKEN'), 32)
    ? currentValues.get('INTERNAL_OPERATIONS_TOKEN')
    : randomSecret(48);
  const grafanaAdminPassword = usableSecret(currentValues.get('GRAFANA_ADMIN_PASSWORD'), 24)
    ? currentValues.get('GRAFANA_ADMIN_PASSWORD')
    : randomSecret(32);
  const backupHmacKey = usableSecret(currentValues.get('BACKUP_MANIFEST_HMAC_KEY'), 32)
    ? currentValues.get('BACKUP_MANIFEST_HMAC_KEY')
    : randomSecret(48);
  const appUrl = selfHostChoices?.publicUrl || 'http://localhost:3000';
  const bucket = currentValues.get('S3_BUCKET') || 'memoria-uploads';

  raw = upsertEnvValue(raw, 'NODE_ENV', isProduction ? 'production' : 'development');
  raw = upsertEnvValue(raw, 'DATABASE_PASSWORD', databasePassword);
  raw = upsertEnvValue(
    raw,
    'DATABASE_URL',
    inContainers
      ? `postgresql://memoria:${databasePassword}@postgres:5432/memoria`
      : `postgresql://memoria:${databasePassword}@localhost:5432/memoria`
  );
  raw = upsertEnvValue(raw, 'REDIS_PASSWORD', redisPassword);
  raw = upsertEnvValue(
    raw,
    'REDIS_URL',
    inContainers
      ? `redis://:${redisPassword}@redis:6379`
      : `redis://:${redisPassword}@localhost:6379`
  );
  raw = upsertEnvValue(raw, 'AUTH_URL', appUrl);
  raw = upsertEnvValue(raw, 'NEXTAUTH_URL', appUrl);
  raw = upsertEnvValue(raw, 'AUTH_SECRET', authSecret);
  raw = upsertEnvValue(raw, 'NEXTAUTH_SECRET', authSecret);
  raw = upsertEnvValue(raw, 'APP_BOOTSTRAP_TOKEN', bootstrapToken);
  raw = upsertEnvValue(raw, 'INTERNAL_OPERATIONS_TOKEN', operationsToken);
  raw = upsertEnvValue(raw, 'GRAFANA_ADMIN_PASSWORD', grafanaAdminPassword);
  raw = upsertEnvValue(
    raw,
    'TRUSTED_PROXY_CIDRS',
    currentValues.get('TRUSTED_PROXY_CIDRS') ||
      (targetMode === 'small' ? SMALL_NETWORK_GATEWAY_CIDR : isProduction ? EDGE_NETWORK_CIDR : ''),
  );
  if (targetMode === 'small') {
    // No gateway: operations routes are on the app's own loopback port.
    raw = upsertEnvValue(
      raw,
      'OPERATIONS_BASE_URL',
      `http://127.0.0.1:${currentValues.get('APP_HOST_PORT') || '3000'}`,
    );
    // The app forwards live connections to sync itself and signs who sent
    // them, so per-person limits still hold without a gateway.
    raw = upsertEnvValue(
      raw,
      'COLLABORATION_PROXY_SECRET',
      usableSecret(currentValues.get('COLLABORATION_PROXY_SECRET'), 32)
        ? currentValues.get('COLLABORATION_PROXY_SECRET')
        : randomSecret(48),
    );
  }
  raw = upsertEnvValue(raw, 'REGISTRATION_MODE', currentValues.get('REGISTRATION_MODE') || 'open');
  raw = upsertEnvValue(raw, 'AUTH_RATE_LIMIT_MAX_REQUESTS', currentValues.get('AUTH_RATE_LIMIT_MAX_REQUESTS') || '5');
  raw = upsertEnvValue(raw, 'EMAIL_PROVIDER', selfHostChoices?.emailProvider || 'console');
  raw = upsertEnvValue(raw, 'EMAIL_FROM', selfHostChoices?.emailFrom || 'noreply@memoria.local');
  raw = upsertEnvValue(raw, 'EMAIL_SENDER_VERIFIED', selfHostChoices ? 'true' : 'false');
  raw = upsertEnvValue(raw, 'EMAIL_DELIVERY_PROBE_TO', selfHostChoices?.emailDeliveryProbeTo || '');
  if (selfHostChoices?.emailProvider === 'sendgrid') {
    raw = upsertEnvValue(raw, 'SENDGRID_API_KEY', selfHostChoices.providerKey);
  }
  if (selfHostChoices?.emailProvider === 'resend') {
    raw = upsertEnvValue(raw, 'RESEND_API_KEY', selfHostChoices.providerKey);
  }
  raw = upsertEnvValue(raw, 'MODEL_CREDENTIAL_ENCRYPTION_KEY', modelCredentialKey);
  raw = upsertEnvValue(raw, 'CRON_SECRET', cronSecret);
  raw = upsertEnvValue(raw, 'UPLOAD_STORAGE', targetMode === 'small' ? 'local' : 's3');
  raw = upsertEnvValue(raw, 'UPLOAD_LOCAL_DIR', targetMode === 'small' ? '/data/uploads' : '');
  raw = upsertEnvValue(raw, 'S3_BUCKET', bucket);
  raw = upsertEnvValue(raw, 'S3_REGION', 'us-east-1');
  raw = upsertEnvValue(raw, 'S3_ENDPOINT', targetMode === 'selfhost' ? 'http://minio:9000' : 'http://localhost:9000');
  raw = upsertEnvValue(raw, 'UPLOADS_PUBLIC_URL', '');
  raw = upsertEnvValue(raw, 'S3_ACCESS_KEY_ID', minioUser);
  raw = upsertEnvValue(raw, 'S3_SECRET_ACCESS_KEY', minioPassword);
  raw = upsertEnvValue(raw, 'MINIO_ROOT_USER', minioUser);
  raw = upsertEnvValue(raw, 'MINIO_ROOT_PASSWORD', minioPassword);
  raw = upsertEnvValue(raw, 'BACKUP_BUCKET', selfHostChoices?.backupBucket || currentValues.get('BACKUP_BUCKET') || 'memoria-backups');
  raw = upsertEnvValue(raw, 'BACKUP_RETENTION_DAYS', currentValues.get('BACKUP_RETENTION_DAYS') || '35');
  raw = upsertEnvValue(raw, 'BACKUP_MANIFEST_HMAC_KEY', backupHmacKey);
  raw = upsertEnvValue(raw, 'BACKUP_S3_ENDPOINT', selfHostChoices?.backupEndpoint || '');
  raw = upsertEnvValue(raw, 'BACKUP_S3_REGION', selfHostChoices?.backupRegion || 'us-east-1');
  raw = upsertEnvValue(raw, 'BACKUP_S3_ACCESS_KEY_ID', selfHostChoices?.backupAccessKeyId || '');
  raw = upsertEnvValue(raw, 'BACKUP_S3_SECRET_ACCESS_KEY', selfHostChoices?.backupSecretAccessKey || '');
  raw = upsertEnvValue(raw, 'BACKUP_S3_SSE', selfHostChoices?.backupSse || 'AES256');
  raw = upsertEnvValue(raw, 'FEATURE_BOOKMARK_UNFURLING', currentValues.get('FEATURE_BOOKMARK_UNFURLING') || 'true');
  raw = upsertEnvValue(raw, 'BOOKMARK_REFRESH_INTERVAL_MS', currentValues.get('BOOKMARK_REFRESH_INTERVAL_MS') || '900000');
  raw = upsertEnvValue(raw, 'AI_ACTION_BUDGET_DAILY', currentValues.get('AI_ACTION_BUDGET_DAILY') || '1000');
  if (selfHostChoices?.smtp) {
    raw = upsertEnvValue(raw, 'SMTP_HOST', selfHostChoices.smtp.host);
    raw = upsertEnvValue(raw, 'SMTP_PORT', selfHostChoices.smtp.port);
    raw = upsertEnvValue(raw, 'SMTP_SECURE', selfHostChoices.smtp.secure);
    raw = upsertEnvValue(raw, 'SMTP_USER', selfHostChoices.smtp.user);
    raw = upsertEnvValue(raw, 'SMTP_PASS', selfHostChoices.smtp.pass);
  } else {
    raw = upsertEnvValue(raw, 'SMTP_PASS', '');
  }

  writeEnvFile(targetPath, raw);
  return { bootstrapToken, operationsToken, bucket };
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

if (!['dev', 'selfhost', 'small'].includes(mode)) {
  throw new Error(
    'Usage: node scripts/setup.mjs <dev|selfhost|small> [--seed] [--force] [--no-build]',
  );
}

const envPath =
  mode === 'selfhost' ? selfHostEnvFile : mode === 'small' ? smallEnvFile : defaultEnvFile;
const selfHostChoices = mode === 'dev' ? null : getSelfHostChoices({ small: mode === 'small' });
const { bootstrapToken, operationsToken, bucket } = prepareEnv(envPath, mode, selfHostChoices);
const envValues = readEnvFile(envPath).values;
const composeFile = mode === 'small' ? 'docker-compose.small.yml' : 'docker-compose.yml';
const composeArgs = ['compose', '--env-file', envPath, '-f', composeFile];

if (mode === 'small') {
  const appPort = Number(envValues.get('APP_HOST_PORT') || 3000);
  const localUrl = `http://127.0.0.1:${appPort}`;
  // `--no-build` starts an image built or pulled beforehand (MEMORIA_IMAGE).
  const build = flags.has('--no-build') ? [] : ['--build'];
  await run(docker, [...composeArgs, 'up', '-d', ...build, '--wait'], {
    cwd: projectRoot,
  });
  const smokeReport = await runSmokeChecks({
    baseUrl: localUrl,
    operationsBaseUrl: localUrl,
    requireRunningApp: true,
    operationsToken,
  });
  // The app forwards live connections to the sync server; check that path.
  const live = await probeLiveConnection(localUrl, {
    timeoutMs: 6000,
    origin: selfHostChoices.publicUrl,
  });
  const failures = smokeReport.results
    .filter((result) => result.status === 'fail')
    .map((result) => `${result.name}: ${result.detail}`);
  if (!live.ok) failures.push(`live-connection: ${live.reason}`);
  if (failures.length > 0) {
    throw new Error(
      `Small setup checks failed: ${failures.join('; ')}. Run pnpm doctor:small for fixes.`,
    );
  }

  printSection('Small Setup Complete', [
    `Environment file: ${envPath}`,
    `Running on this machine at: ${localUrl}`,
    `Public address: ${selfHostChoices.publicUrl}`,
    'Point your TLS proxy at the address above, passing WebSockets for /api/collaboration/.',
    'First account: open /setup on your public address (it runs the set-up check first).',
    `Bootstrap token (store securely; shown once): ${bootstrapToken}`,
    'Uploads: the uploads_data volume. Back it up with the database (no backup service runs).',
    'Check again any time: pnpm doctor:small',
  ]);
} else if (mode === 'dev') {
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
  await ensureS3Bucket({
    endpoint: selfHostChoices.backupEndpoint || undefined,
    region: selfHostChoices.backupRegion,
    accessKeyId: selfHostChoices.backupAccessKeyId,
    secretAccessKey: selfHostChoices.backupSecretAccessKey,
    bucket: selfHostChoices.backupBucket,
    createIfMissing: false,
    requireVersioning: true,
  });
  await run(docker, [...composeArgs, 'up', '-d', '--build'], {
    cwd: projectRoot,
  });
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
    operationsBaseUrl: 'http://127.0.0.1:3002',
    requireRunningApp: true,
    operationsToken,
  });

  if (smokeReport.hasFailure) {
    throw new Error(
      `Self-host smoke checks failed: ${smokeReport.results
        .filter((result) => result.status === 'fail')
        .map((result) => `${result.name}: ${result.detail}`)
        .join('; ')}`
    );
  }

  const deliveryProbeId = await runEmailDeliveryProbe({
    operationsBaseUrl: 'http://127.0.0.1:3002',
    operationsToken,
  });

  printSection('Self-Host Setup Complete', [
    `Environment file: ${envPath}`,
    `App URL: ${selfHostChoices.publicUrl}`,
    'Bootstrap path: /setup',
    `Bootstrap token (store securely; shown once): ${bootstrapToken}`,
    'MinIO Console: bound to http://127.0.0.1:9001',
    'Smoke checks: passed',
    `Email delivery probe: ${deliveryProbeId} completed; confirm receipt in ${selfHostChoices.emailDeliveryProbeTo}`,
  ]);
}
