import { existsSync } from 'fs';
import { resolve } from 'path';
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
  smallEnvFile,
  waitForPort,
} from './lib/runtime.mjs';
import { runSmokeChecks } from './lib/smoke.mjs';
import { probeLiveConnection } from './lib/live-connection.mjs';
import { setupFix } from '../src/lib/operations/setup-fixes.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const asJson = flags.has('--json');
const envFile = process.env.MEMORIA_ENV_FILE
  ? resolve(projectRoot, process.env.MEMORIA_ENV_FILE)
  : flags.has('--selfhost')
    ? selfHostEnvFile
    : flags.has('--small')
      ? smallEnvFile
      : defaultEnvFile;
const results = [];
// IMP-100: the small set-up keeps PostgreSQL and Redis inside its own
// network, so the database, Redis, tables and uploads are checked through
// the running app's readiness instead of from this machine.
const small = flags.has('--small');

function addCheck(name, status, detail, fix) {
  results.push(status !== 'pass' && fix ? { name, status, detail, fix } : { name, status, detail });
}

function redactedConnectionTarget(value, fallbackPort) {
  if (!value) return 'Missing';
  const target = parseConnectionTarget(value, fallbackPort);
  return `${target.host}:${target.port}`;
}

if (!existsSync(envFile)) {
  addCheck('env-file', 'fail', `Missing environment file: ${envFile}`);
} else {
  addCheck('env-file', 'pass', envFile);
}

const envValues = readEnvFile(envFile).values;
const emailProvider = envValues.get('EMAIL_PROVIDER') || 'console';
const authUrl = envValues.get('AUTH_URL') || envValues.get('NEXTAUTH_URL');

// The bundled stack (--selfhost, or a production env with an HTTPS public URL)
// always sits behind the Caddy gateway; an empty value makes every client share
// the gateway's address for rate limits, lockout and connection caps.
const behindProxy =
  flags.has('--selfhost') ||
  flags.has('--small') ||
  authUrl?.startsWith('https://') ||
  envValues.get('NODE_ENV') === 'production';
if (behindProxy && !envValues.get('TRUSTED_PROXY_CIDRS')?.trim()) {
  addCheck(
    'trusted-proxy',
    'warn',
    'App is behind a proxy but TRUSTED_PROXY_CIDRS is empty; all clients share the proxy address for rate limits and lockout. Run pnpm setup or set the gateway network CIDR.'
  );
}

for (const key of ['DATABASE_URL', 'AUTH_URL', 'AUTH_SECRET']) {
  addCheck(key, envValues.get(key) ? 'pass' : 'fail', envValues.get(key) ? 'Configured' : 'Missing');
}

if (emailProvider === 'smtp') {
  const missingSmtp = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'].filter(
    (key) => !envValues.get(key) && !(key === 'SMTP_PASS' && envValues.get('SMTP_PASSWORD'))
  );
  if (missingSmtp.length > 0) {
    addCheck('email-provider', 'fail', `Missing ${missingSmtp.join(', ')} for EMAIL_PROVIDER=smtp`);
  } else {
    const smtpHost = envValues.get('SMTP_HOST');
    const smtpPort = Number(envValues.get('SMTP_PORT'));
    const smtpSecure = envValues.get('SMTP_SECURE') === 'true';
    addCheck(
      'email-provider',
      'pass',
      `smtp (${smtpHost}:${smtpPort}, ${smtpSecure ? 'implicit TLS' : 'STARTTLS required in production'})`
    );
    try {
      await waitForPort({
        host: smtpHost,
        port: smtpPort,
        label: 'SMTP',
        timeoutMs: 5000,
      });
      addCheck('smtp-server', 'pass', `${smtpHost}:${smtpPort}`);
    } catch (error) {
      addCheck('smtp-server', 'fail', error instanceof Error ? error.message : 'Unreachable');
    }
  }
} else {
  addCheck('email-provider', 'pass', emailProvider);
}

if ((envValues.get('NODE_ENV') || 'development') === 'production') {
  const securityKeys = [
    'AUTH_SECRET',
    'APP_BOOTSTRAP_TOKEN',
    'INTERNAL_OPERATIONS_TOKEN',
    'MODEL_CREDENTIAL_ENCRYPTION_KEY',
    'CRON_SECRET',
    'BACKUP_MANIFEST_HMAC_KEY',
  ];

  for (const key of securityKeys) {
    const val = envValues.get(key);
    if (!val) {
      addCheck(key, 'fail', 'Missing in production environment');
    } else if (/replace-me|replace-with|devpassword|minioadmin/i.test(val)) {
      addCheck(key, 'fail', 'Contains a known placeholder value');
    } else if (val.length < 24) {
      addCheck(key, 'fail', `Too short (${val.length} chars, minimum 24 required)`);
    } else {
      addCheck(key, 'pass', 'Configured securely');
    }
  }

  const registrationMode = envValues.get('REGISTRATION_MODE');
  addCheck(
    'registration-mode',
    !registrationMode ? 'fail' : registrationMode === 'open' ? 'warn' : 'pass',
    !registrationMode
      ? 'Missing explicit production choice (open, invite, or closed)'
      : registrationMode === 'open'
        ? 'Open public account creation is enabled by operator choice'
        : registrationMode
  );
}

if (envValues.get('REDIS_URL') && !small) {
  try {
    await waitForPort({ ...parseConnectionTarget(envValues.get('REDIS_URL'), 6379), label: 'Redis', timeoutMs: 5000 });
    addCheck('redis', 'pass', redactedConnectionTarget(envValues.get('REDIS_URL'), 6379));
  } catch (error) {
    addCheck(
      'redis',
      'fail',
      error instanceof Error ? error.message : 'Unreachable',
      setupFix('redis'),
    );
  }
}

if (envValues.get('DATABASE_URL') && !small) {
  try {
    await waitForPort({
      ...parseConnectionTarget(envValues.get('DATABASE_URL'), 5432),
      label: 'Postgres',
      timeoutMs: 5000,
    });
    addCheck('database', 'pass', redactedConnectionTarget(envValues.get('DATABASE_URL'), 5432));
  } catch (error) {
    addCheck(
      'database',
      'fail',
      error instanceof Error ? error.message : 'Unreachable',
      setupFix('database'),
    );
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
    addCheck(
      'object-storage',
      'fail',
      error instanceof Error ? error.message : 'Unreachable',
      setupFix('storage'),
    );
  }
} else if (envValues.get('NODE_ENV') === 'production') {
  // IMP-100 small set-up: uploads on a mounted folder inside the app
  // container; the app's own readiness check writes a probe file there.
  addCheck(
    'object-storage',
    envValues.get('UPLOAD_LOCAL_DIR') ? 'pass' : 'fail',
    envValues.get('UPLOAD_LOCAL_DIR')
      ? `Uploads on disk at ${envValues.get('UPLOAD_LOCAL_DIR')} (checked by the app's readiness)`
      : 'UPLOAD_STORAGE=local needs UPLOAD_LOCAL_DIR in production',
    setupFix('storage'),
  );
}

const authUrlValue =
  envValues.get('AUTH_URL') || envValues.get('NEXTAUTH_URL');
let smokeReport = { results: [] };
if (flags.has('--smoke') || authUrlValue) {
  // `--smoke` is the operator gate against a real deployment, so it keeps the
  // default 5s budget: a cold route or a remote host routinely needs more than
  // a second. Without it we are only probing an app that is probably not
  // running, and a short timeout keeps `pnpm doctor` responsive.
  try {
    smokeReport = await runSmokeChecks({
      baseUrl: authUrlValue || 'http://localhost:3000',
      operationsBaseUrl:
        envValues.get('OPERATIONS_BASE_URL') || authUrlValue || 'http://localhost:3000',
      requireRunningApp: flags.has('--smoke'),
      operationsToken: envValues.get('INTERNAL_OPERATIONS_TOKEN'),
      ...(flags.has('--smoke') ? {} : { timeoutMs: 1000 }),
    });
  } catch (error) {
    // A half-reachable app (e.g. the operations address is wrong) is a
    // finding, not a crash of the check itself.
    smokeReport = {
      results: [
        {
          name: 'app',
          status: flags.has('--smoke') ? 'fail' : 'warn',
          detail: `Smoke checks stopped: ${error?.cause?.message || error?.message || error}. Check that the app is running and OPERATIONS_BASE_URL points at its loopback port.`,
        },
      ],
    };
  }
} else {
  smokeReport = {
    results: [
      {
        name: 'app-url',
        status: 'warn',
        detail: 'AUTH_URL is not configured',
      },
    ],
  };
}

for (const result of smokeReport.results) {
  addCheck(`smoke:${result.name}`, result.status, result.detail);
}

// IMP-100: open a live collaboration connection the way a browser does,
// through the public address, so a proxy that drops WebSockets shows here.
if (authUrlValue) {
  const live = await probeLiveConnection(authUrlValue, {
    timeoutMs: flags.has('--smoke') ? 6000 : 3000,
  });
  addCheck(
    'live-connection',
    live.ok ? 'pass' : flags.has('--smoke') ? 'fail' : 'warn',
    live.ok ? `Opened ${live.url}` : `${live.url}: ${live.reason}`,
    // 502-504: the proxy or app passed the connection on, but the sync
    // server behind it did not answer.
    /HTTP 50[234]/.test(live.reason ?? '') ? setupFix('sync-server') : setupFix('live-connection'),
  );
}

if (small) {
  const operationsBase =
    envValues.get('OPERATIONS_BASE_URL') ||
    `http://127.0.0.1:${envValues.get('APP_HOST_PORT') || '3000'}`;
  const names = {
    database: ['database', 'database'],
    migrations: ['migrations', 'migrations'],
    redis: ['redis', 'redis'],
    'upload-storage': ['upload-storage', 'storage'],
  };
  try {
    const response = await fetch(new URL('/api/ready', operationsBase), {
      headers: {
        Authorization: `Bearer ${envValues.get('INTERNAL_OPERATIONS_TOKEN')}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    const snapshot = await response.json().catch(() => null);
    if (!snapshot?.checks) throw new Error(`readiness answered HTTP ${response.status}`);
    for (const check of snapshot.checks) {
      const [name, fixName] = names[check.name] ?? [check.name, null];
      addCheck(
        name,
        check.status === 'ok' ? 'pass' : 'fail',
        check.status === 'ok' ? 'Working (checked by the app)' : 'Not working (checked by the app)',
        fixName ? setupFix(fixName) : undefined,
      );
    }
  } catch (error) {
    addCheck(
      'app-readiness',
      'fail',
      error?.cause?.message || error?.message || 'Unreachable',
      `The app is not answering on ${operationsBase}. Start the small set-up (docker compose -f docker-compose.small.yml --env-file .env.small up -d) and look at the app logs.`,
    );
  }
} else if (envValues.get('DATABASE_URL')) {
  const pnpm = getPnpmCommand();
  try {
    await run(
      pnpm,
      ['exec', 'prisma', 'migrate', 'status', '--schema', 'prisma/schema.prisma'],
      {
        cwd: projectRoot,
        env: { ...process.env, MEMORIA_ENV_FILE: envFile },
      }
    );
    addCheck('migrations', 'pass', 'Prisma migration status completed');
  } catch (error) {
    addCheck(
      'migrations',
      'fail',
      error instanceof Error ? error.message : 'Migration status failed',
      setupFix('migrations'),
    );
  }
} else {
  addCheck('migrations', 'fail', 'DATABASE_URL is not configured');
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

addCheck(
  'vector-extension',
  'pass',
  'Not required: embeddings are stored as JSON in the current schema'
);

const hasFailure = results.some((entry) => entry.status === 'fail');

if (asJson) {
  console.log(JSON.stringify({ envFile, results }, null, 2));
} else {
  for (const result of results) {
    const prefix =
      result.status === 'pass' ? 'PASS' : result.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`${prefix} ${result.name}: ${result.detail}`);
    if (result.fix) console.log(`     Fix: ${result.fix}`);
  }
}

if (hasFailure) {
  process.exit(1);
}
