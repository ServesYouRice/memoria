#!/usr/bin/env node

import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { gzipSync } from 'zlib';

const BUDGETS = {
  shared: 250 * 1024,
  landing: 100 * 1024,
  auth: 125 * 1024,
  canvas: 150 * 1024,
};
const buildManifest = JSON.parse(readFileSync('.next/build-manifest.json', 'utf8'));
const appRoot = join('.next', 'static', 'chunks', 'app');

function filesUnder(directory, output = []) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) filesUnder(path, output);
    else if (entry.endsWith('.js')) output.push(path);
  }
  return output;
}

const appFiles = filesUnder(appRoot);
const normalized = (file) => relative(appRoot, file).split(sep).join('/');
const groups = {
  shared: [...new Set(buildManifest.rootMainFiles || [])].map((file) => join('.next', file)),
  landing: appFiles.filter((file) => /^page-[^/]+\.js$/.test(normalized(file))),
  auth: appFiles.filter((file) => normalized(file).startsWith('auth/')),
  canvas: appFiles.filter((file) => normalized(file).startsWith('canvas/')),
};

const results = {};
let failed = false;
for (const [group, files] of Object.entries(groups)) {
  if (files.length === 0) {
    console.error(`${group}: no chunks were classified`);
    failed = true;
    results[group] = { files: 0, gzipBytes: 0, budgetBytes: BUDGETS[group], status: 'empty' };
    continue;
  }
  const gzipBytes = files.reduce(
    (total, file) => total + gzipSync(readFileSync(file)).length,
    0,
  );
  const status = gzipBytes <= BUDGETS[group] ? 'pass' : 'exceeded';
  if (status !== 'pass') failed = true;
  results[group] = { files: files.length, gzipBytes, budgetBytes: BUDGETS[group], status };
  console.log(
    `${group}: ${(gzipBytes / 1024).toFixed(2)} KiB / ${(BUDGETS[group] / 1024).toFixed(0)} KiB (${status})`,
  );
}

writeFileSync('.next/bundle-budget.json', `${JSON.stringify({ results }, null, 2)}\n`);
if (failed) process.exit(1);
