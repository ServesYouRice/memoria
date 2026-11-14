#!/usr/bin/env node
// Release command (IMP-148, handbook ME-01). Builds the image from a clean
// commit, scans it, and with --push publishes it and prints the digest that
// the infra repo pins (infra README, "How a release lands"). It never touches
// infra.
//
//   pnpm release                  dry run: audit, build, Trivy scan
//   pnpm release --push           the same, then push and print the digest
//   pnpm release --image <name>   another repository (default below)
//
// A high or critical finding from `pnpm audit` or Trivy stops the release.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const DEFAULT_IMAGE = 'ghcr.io/servesyourice/memoria';

export function parseArgs(argv) {
  const options = { push: false, image: DEFAULT_IMAGE };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--push') options.push = true;
    else if (arg === '--image') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--'))
        throw new Error('--image needs a repository name');
      options.image = value;
      index += 1;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function defaultRun(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
}

/**
 * Runs the release. `run(command, args, { capture })` returns
 * `{ status, stdout }`; tests pass a fake.
 */
export function release(options, { run = defaultRun, log = console.log } = {}) {
  const must = (step, command, args, capture = false) => {
    const result = run(command, args, { capture });
    if (result.status !== 0) {
      throw new Error(`${step} failed (exit ${result.status}); release stopped.`);
    }
    return result.stdout.trim();
  };

  const dirty = must('git status', 'git', ['status', '--porcelain'], true);
  if (dirty) {
    throw new Error(
      'The worktree has uncommitted changes; release only from a clean commit.',
    );
  }
  const revision = must('git rev-parse', 'git', ['rev-parse', 'HEAD'], true);
  const tag = `${options.image}:${revision.slice(0, 12)}`;

  log('Checking dependencies (pnpm audit, high and above)...');
  must('pnpm audit', 'pnpm', ['audit', '--prod', '--audit-level', 'high']);

  log(`Building ${tag}...`);
  must('docker build', 'docker', [
    'build',
    '--pull',
    '--label',
    `org.opencontainers.image.revision=${revision}`,
    '--tag',
    tag,
    '.',
  ]);

  log('Scanning the image (Trivy, high and above)...');
  must('Trivy scan', 'trivy', [
    'image',
    '--exit-code',
    '1',
    '--severity',
    'HIGH,CRITICAL',
    '--ignore-unfixed',
    tag,
  ]);

  if (!options.push) {
    log(`Dry run: built and scanned ${tag}. Run again with --push to publish.`);
    return { revision, tag, digest: null };
  }

  must('docker push', 'docker', ['push', tag]);
  const repoDigests = must(
    'docker inspect',
    'docker',
    ['image', 'inspect', '--format', '{{json .RepoDigests}}', tag],
    true,
  );
  const reference = JSON.parse(repoDigests || '[]').find((entry) =>
    entry.startsWith(`${options.image}@sha256:`),
  );
  if (!reference) throw new Error(`No pushed digest found for ${tag}.`);
  const digest = reference.slice(reference.indexOf('@') + 1);
  log(`Released commit ${revision} as ${options.image}@${digest}`);
  log(
    'Next: set digest and APP_REVISION in infra apps/memoria/staging/release/kustomization.yaml.',
  );
  return { revision, tag, digest };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    release(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
