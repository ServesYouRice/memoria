#!/usr/bin/env node
// Local verification gate. Replaces the former hosted CI workflow: every job
// that workflow ran is a stage here, run on the owner's machine.
//
//   pnpm gate                       fast stage (default)
//   pnpm gate build audit           named stages, in the order given
//   pnpm gate all                   every stage, in dependency order
//   pnpm gate --list                print stages and what each runs
//
// Stages that need Docker, PostgreSQL, or browsers are explicit opt-ins.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';


// Single source of truth for the supported toolchain pins. These must match
// package.json (engines.node, packageManager) and the Dockerfile base image;
// tests/unit/runtime-alignment.test.ts fails when they drift.
export const NODE_VERSION = '24.20.0';
// 11.13.0 shipped a broken @pnpm/exe build with no binary; do not pin it.
export const PNPM_VERSION = '11.13.1';

// prisma.config.ts resolves the datasource from DATABASE_URL, so `prisma
// generate` refuses to run without one even though generation never connects.
const PRISMA_GENERATE_DATABASE_URL =
  'postgresql://placeholder:placeholder@localhost:5432/placeholder';

// `next build` runs under NODE_ENV=production, so route modules that import
// the env module trigger the production-only requirements. Placeholders only.
const BUILD_ENV = {
  DATABASE_URL: PRISMA_GENERATE_DATABASE_URL,
  AUTH_SECRET: 'ci-build-secret-0123456789abcdef-placeholder',
  AUTH_URL: 'http://localhost:3000',
  NEXTAUTH_SECRET: 'ci-build-secret-0123456789abcdef-placeholder',
  NEXTAUTH_URL: 'http://localhost:3000',
  REDIS_URL: 'redis://localhost:6379',
  UPLOAD_STORAGE: 's3',
  S3_BUCKET: 'ci-placeholder-bucket',
  S3_REGION: 'us-east-1',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY_ID: 'ci-placeholder',
  S3_SECRET_ACCESS_KEY: 'ci-placeholder-secret',
  APP_BOOTSTRAP_TOKEN: 'ci-placeholder-bootstrap-token',
  INTERNAL_OPERATIONS_TOKEN: 'ci-operations-token-0123456789abcdef',
  MODEL_CREDENTIAL_ENCRYPTION_KEY: 'ci-model-credential-key-0123456789abcdef',
  EMAIL_PROVIDER: 'sendgrid',
  SENDGRID_API_KEY: 'ci-placeholder-sendgrid-key',
};

const DENIED_LICENSES = ['GPL-3.0', 'AGPL-3.0'];

// pnpm is a .cmd shim on Windows, which spawnSync runs only through a shell.
// Every argument here is a plain token, so no quoting is needed.
const shell = process.platform === 'win32';
const pnpm = (...args) => ({ cmd: 'pnpm', args });
const generate = {
  ...pnpm('db:generate'),
  env: { DATABASE_URL: PRISMA_GENERATE_DATABASE_URL },
};

// Order matters for `all`: it mirrors the old job dependency graph.
export const STAGES = {
  fast: {
    summary: 'install, prisma generate, lint, type-check, unit tests + coverage, route coverage',
    steps: [
      pnpm('install', '--frozen-lockfile'),
      generate,
      pnpm('lint'),
      pnpm('type-check'),
      pnpm('test:coverage'),
      pnpm('test:coverage:routes'), // evidence: coverage/routes/
    ],
  },
  integration: {
    summary: 'PostgreSQL integration tests + schema drift (needs TEST_DATABASE_URL)',
    requireEnv: ['TEST_DATABASE_URL'],
    steps: [generate, pnpm('test:integration')],
  },
  build: {
    summary: 'production build and App Router bundle budgets',
    steps: [
      generate,
      { ...pnpm('build'), env: BUILD_ENV },
      pnpm('check-bundle'), // evidence: .next/bundle-budget.json
    ],
  },
  audit: {
    summary: 'production dependency audit, license inventory, denied-license check',
    steps: [
      pnpm('audit', '--prod', '--audit-level=high'),
      pnpm('licenses', 'list', '--prod'),
      { fn: checkDeniedLicenses, label: `denied licenses (${DENIED_LICENSES.join(', ')})` },
    ],
  },
  container: {
    summary: 'clean production image build and CycloneDX SBOM (needs docker, syft)',
    requireBins: ['docker', 'syft'],
    steps: [
      { cmd: 'docker', args: ['build', '--pull', '--tag', 'memoria:local', '.'] },
      {
        cmd: 'syft',
        args: ['memoria:local', '-o', 'cyclonedx-json=memoria-sbom.cdx.json'],
      },
    ],
  },
  e2e: {
    summary:
      'production image E2E + operations smoke on all Playwright browsers (chromium, firefox, webkit); needs docker',
    requireBins: ['docker'],
    steps: [
      generate,
      pnpm('exec', 'playwright', 'install', '--with-deps'),
      pnpm('test:e2e'), // evidence: playwright-report/, test-results/
    ],
  },
};

function run({ cmd, args, env }) {
  console.log(`\n$ ${[cmd, ...args].join(' ')}`);
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell,
  });
  return result.status === 0;
}

function checkDeniedLicenses() {
  const result = spawnSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
    shell,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || '');
    return false;
  }
  const byLicense = JSON.parse(result.stdout);
  const hits = Object.keys(byLicense).filter((license) =>
    // Match whole SPDX ids: a bare substring test would flag LGPL-3.0-or-later
    // (sharp's dynamically linked libvips) as GPL-3.0.
    DENIED_LICENSES.some((denied) =>
      new RegExp(`(^|[^A-Z])${denied.replace(/\./g, '\\.')}`).test(license.toUpperCase()),
    ),
  );
  for (const license of hits) {
    const names = byLicense[license].map((p) => p.name).join(', ');
    console.error(`denied license ${license}: ${names}`);
  }
  return hits.length === 0;
}

function checkRuntime() {
  const pnpmVersion = spawnSync('pnpm', ['--version'], { encoding: 'utf8', shell }).stdout?.trim();
  const problems = [];
  if (process.versions.node !== NODE_VERSION) {
    problems.push(`node ${process.versions.node} (expected ${NODE_VERSION})`);
  }
  if (pnpmVersion !== PNPM_VERSION) {
    problems.push(`pnpm ${pnpmVersion} (expected ${PNPM_VERSION})`);
  }
  if (problems.length === 0) return true;
  const message = `runtime differs from pinned toolchain: ${problems.join('; ')}`;
  if (process.env.GATE_STRICT_RUNTIME === '1') {
    console.error(message);
    return false;
  }
  console.warn(`warning: ${message} (set GATE_STRICT_RUNTIME=1 to fail)`);
  return true;
}

function runStage(name) {
  const stage = STAGES[name];
  console.log(`\n=== gate stage: ${name} - ${stage.summary} ===`);
  for (const key of stage.requireEnv ?? []) {
    if (!process.env[key]) {
      console.error(`stage "${name}" requires ${key}`);
      return false;
    }
  }
  for (const bin of stage.requireBins ?? []) {
    if (spawnSync(bin, ['--version'], { stdio: 'ignore', shell }).status !== 0) {
      console.error(`stage "${name}" requires "${bin}" on PATH`);
      return false;
    }
  }
  for (const step of stage.steps) {
    if (step.fn) console.log(`\n# ${step.label}`);
    const ok = step.fn ? step.fn() : run(step);
    if (!ok) {
      console.error(`\ngate stage "${name}" FAILED`);
      return false;
    }
  }
  console.log(`\ngate stage "${name}" passed`);
  return true;
}

function main(argv) {
  if (argv.includes('--list')) {
    for (const [name, stage] of Object.entries(STAGES)) {
      console.log(`${name.padEnd(12)} ${stage.summary}`);
    }
    return 0;
  }
  let names = argv.length === 0 ? ['fast'] : argv;
  if (names.includes('all')) names = Object.keys(STAGES);
  const unknown = names.filter((n) => !STAGES[n]);
  if (unknown.length > 0) {
    console.error(`unknown stage(s): ${unknown.join(', ')}; try --list`);
    return 2;
  }
  if (!checkRuntime()) return 1;
  for (const name of names) if (!runStage(name)) return 1;
  console.log(`\ngate passed: ${names.join(', ')}`);
  return 0;
}

// Importable for tests without running the gate. pathToFileURL, not a
// `file://` template: on Windows argv[1] is `C:\...` and never matched.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
