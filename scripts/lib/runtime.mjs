import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createConnection } from 'net';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const currentDir = dirname(fileURLToPath(import.meta.url));

export const projectRoot = resolve(currentDir, '..', '..');
export const defaultEnvFile = resolve(projectRoot, '.env');
export const selfHostEnvFile = resolve(projectRoot, '.env.selfhost');
export const envTemplateFile = resolve(projectRoot, '.env.example');

export function getPnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

export function getDockerCommand() {
  return process.platform === 'win32' ? 'docker.exe' : 'docker';
}

export function parseArgs(argv) {
  const flags = new Set();
  const values = [];

  for (const arg of argv) {
    if (arg.startsWith('--')) {
      flags.add(arg);
    } else {
      values.push(arg);
    }
  }

  return { flags, values };
}

export function readEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return { raw: '', values: new Map() };
  }

  const raw = readFileSync(filePath, 'utf8');
  const values = new Map();

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^"|"$/g, '');
    values.set(key, value);
  }

  return { raw, values };
}

export function writeEnvFile(filePath, raw) {
  writeFileSync(filePath, raw, 'utf8');
}

export function upsertEnvValue(raw, key, value) {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const line = `${key}="${escaped}"`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');

  if (pattern.test(raw)) {
    return raw.replace(pattern, line);
  }

  const suffix = raw.endsWith('\n') || raw.length === 0 ? '' : '\n';
  return `${raw}${suffix}${line}\n`;
}

export function ensureEnvFile(targetPath, { force = false } = {}) {
  if (!force && existsSync(targetPath)) {
    return readEnvFile(targetPath).raw;
  }

  const template = readFileSync(envTemplateFile, 'utf8');
  writeEnvFile(targetPath, template);
  return template;
}

export function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export async function run(command, args, options = {}) {
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);

  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd || projectRoot,
      stdio: options.stdio || 'inherit',
      env: options.env || process.env,
      shell: needsShell,
    });

    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`));
    });
  });
}

export function parseConnectionTarget(urlString, fallbackPort) {
  try {
    const parsed = new URL(urlString);
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : fallbackPort,
    };
  } catch {
    return { host: '127.0.0.1', port: fallbackPort };
  }
}

export async function waitForPort({ host, port, label, timeoutMs = 120000 }) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const reachable = await new Promise((resolvePromise) => {
      const socket = createConnection({ host, port });
      socket.setTimeout(2000);
      socket.once('connect', () => {
        socket.end();
        resolvePromise(true);
      });
      const onFailure = () => {
        socket.destroy();
        resolvePromise(false);
      };
      socket.once('error', onFailure);
      socket.once('timeout', onFailure);
    });

    if (reachable) {
      return;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }

  throw new Error(`Timed out waiting for ${label} on ${host}:${port}`);
}

export async function ensureS3Bucket({
  endpoint,
  region,
  accessKeyId,
  secretAccessKey,
  bucket,
  createIfMissing = true,
}) {
  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle: Boolean(endpoint),
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    if (!createIfMissing) {
      throw new Error(`Bucket ${bucket} is not reachable or does not exist.`);
    }

    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

export function printSection(title, lines) {
  console.log(`\n${title}`);
  for (const line of lines) {
    console.log(`- ${line}`);
  }
}
