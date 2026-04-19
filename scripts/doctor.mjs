import { existsSync } from 'fs';
import {
  defaultEnvFile,
  ensureS3Bucket,
  getPnpmCommand,
  parseArgs,
  parseConnectionTarget,
  projectRoot,
  readEnvFile,
  run,
  selfHostEnvFile,
  waitForPort,
} from './lib/runtime.mjs';
import { runSmokeChecks } from './lib/smoke.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const asJson = flags.has('--json');
const envFile = flags.has('--selfhost') ? selfHostEnvFile : defaultEnvFile;
const results = [];

function addCheck(name, status, detail) {
  results.push({ name, status, detail });
}

if (!existsSync(envFile)) {
  addCheck('env-file', 'fail', `Missing environment file: ${envFile}`);
} else {
  addCheck('env-file', 'pass', envFile);
}

const envValues = readEnvFile(envFile).values;
const emailProvider = envValues.get('EMAIL_PROVIDER') || 'console';

for (const key of ['DATABASE_URL', 'AUTH_URL', 'AUTH_SECRET']) {
  addCheck(key, envValues.get(key) ? 'pass' : 'fail', envValues.get(key) || 'Missing');
}

if (emailProvider === 'smtp') {
  addCheck(
    'email-provider',
    'fail',
    'EMAIL_PROVIDER=smtp is not supported in this build. Use console, sendgrid, or resend.'
  );
} else {
  addCheck('email-provider', 'pass', emailProvider);
}

if ((envValues.get('NODE_ENV') || 'development') === 'production') {
  addCheck(
    'APP_BOOTSTRAP_TOKEN',
    envValues.get('APP_BOOTSTRAP_TOKEN') ? 'pass' : 'fail',
    envValues.get('APP_BOOTSTRAP_TOKEN') ? 'Configured' : 'Missing'
  );
}

if (envValues.get('REDIS_URL')) {
  try {
    await waitForPort({ ...parseConnectionTarget(envValues.get('REDIS_URL'), 6379), label: 'Redis', timeoutMs: 5000 });
    addCheck('redis', 'pass', envValues.get('REDIS_URL'));
  } catch (error) {
    addCheck('redis', 'fail', error instanceof Error ? error.message : 'Unreachable');
  }
}

if (envValues.get('DATABASE_URL')) {
  try {
    await waitForPort({
      ...parseConnectionTarget(envValues.get('DATABASE_URL'), 5432),
      label: 'Postgres',
      timeoutMs: 5000,
    });
    addCheck('database', 'pass', envValues.get('DATABASE_URL'));
  } catch (error) {
    addCheck('database', 'fail', error instanceof Error ? error.message : 'Unreachable');
  }
}

if (envValues.get('UPLOAD_STORAGE') === 's3') {
  try {
    await ensureS3Bucket({
      endpoint: envValues.get('S3_ENDPOINT'),
      region: envValues.get('S3_REGION'),
      accessKeyId: envValues.get('S3_ACCESS_KEY_ID'),
      secretAccessKey: envValues.get('S3_SECRET_ACCESS_KEY'),
      bucket: envValues.get('S3_BUCKET'),
      createIfMissing: false,
    });
    addCheck('object-storage', 'pass', envValues.get('S3_BUCKET'));
  } catch (error) {
    addCheck('object-storage', 'fail', error instanceof Error ? error.message : 'Unreachable');
  }
}

const smokeReport = await runSmokeChecks({
  baseUrl: envValues.get('AUTH_URL') || envValues.get('NEXTAUTH_URL') || 'http://localhost:3000',
  requireRunningApp: flags.has('--smoke'),
});

for (const result of smokeReport.results) {
  addCheck(`smoke:${result.name}`, result.status, result.detail);
}

const pnpm = getPnpmCommand();
try {
  await run(pnpm, ['exec', 'prisma', 'migrate', 'status', '--schema', 'prisma/schema.prisma'], {
    cwd: projectRoot,
    env: { ...process.env, MEMORIA_ENV_FILE: envFile },
  });
  addCheck('migrations', 'pass', 'Prisma migration status completed');
} catch (error) {
  addCheck('migrations', 'fail', error instanceof Error ? error.message : 'Migration status failed');
}

try {
  await run('node', ['scripts/validate-env.mjs'], {
    cwd: projectRoot,
    env: { ...process.env, MEMORIA_ENV_FILE: envFile },
  });
  addCheck('env-validation', 'pass', 'Environment validation passed');
} catch (error) {
  addCheck('env-validation', 'fail', error instanceof Error ? error.message : 'Environment validation failed');
}

try {
  await run('node', ['scripts/vector-check.mjs'], {
    cwd: projectRoot,
    env: { ...process.env, MEMORIA_ENV_FILE: envFile },
  });
  addCheck('vector-extension', 'pass', 'pgvector extension is available');
} catch (error) {
  addCheck('vector-extension', 'fail', error instanceof Error ? error.message : 'Vector extension check failed');
}

const hasFailure = results.some((entry) => entry.status === 'fail');

if (asJson) {
  console.log(JSON.stringify({ envFile, results }, null, 2));
} else {
  for (const result of results) {
    const prefix =
      result.status === 'pass' ? 'PASS' : result.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`${prefix} ${result.name}: ${result.detail}`);
  }
}

if (hasFailure) {
  process.exit(1);
}
