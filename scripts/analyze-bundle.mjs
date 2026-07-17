#!/usr/bin/env node

/**
 * Bundle Size Checker
 *
 * FIXED: Issue #27 - Bundle size monitoring
 *
 * This script analyzes the Next.js build output and reports bundle sizes.
 * Run after `pnpm build` to see bundle statistics.
 *
 * Usage:
 *   node scripts/check-bundle-size.mjs
 *
 * For visual analysis, set ANALYZE=true before building:
 *   ANALYZE=true pnpm build
 */

import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const BUILD_DIR = '.next';
const STATIC_DIR = join(BUILD_DIR, 'static');

// Size thresholds (in KB)
const THRESHOLDS = {
  page: 250, // Max size for a single page bundle
  shared: 500, // Max size for shared chunks
  total: 3000, // Max total JS size
};

function formatBytes(bytes) {
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(2)} KB`;
  }
  return `${(kb / 1024).toFixed(2)} MB`;
}

function getAllFiles(dir, fileList = []) {
  try {
    const files = readdirSync(dir);

    files.forEach((file) => {
      const filePath = join(dir, file);
      const stat = statSync(filePath);

      if (stat.isDirectory()) {
        getAllFiles(filePath, fileList);
      } else {
        fileList.push({ path: filePath, size: stat.size });
      }
    });
  } catch {
    // Directory doesn't exist, skip
  }

  return fileList;
}

function analyzeBundles() {
  console.log('\n📦 Bundle Size Analysis\n');
  console.log('='.repeat(70));

  // Get all JS files from the build
  const jsFiles = getAllFiles(STATIC_DIR).filter((f) => f.path.endsWith('.js'));

  if (jsFiles.length === 0) {
    console.error('\n❌ No build found. Run `pnpm build` first.\n');
    process.exit(1);
  }

  // Categorize files
  const pages = jsFiles.filter((f) => f.path.includes('/pages/'));
  const chunks = jsFiles.filter((f) => f.path.includes('/chunks/'));
  const webpack = jsFiles.filter((f) => f.path.includes('webpack-'));
  const framework = jsFiles.filter((f) => f.path.includes('framework-'));

  // Calculate totals
  const totalSize = jsFiles.reduce((sum, f) => sum + f.size, 0);
  const pageSize = pages.reduce((sum, f) => sum + f.size, 0);
  const chunkSize = chunks.reduce((sum, f) => sum + f.size, 0);

  // Summary
  console.log('\n📊 Summary:');
  console.log(`   Total JS size:     ${formatBytes(totalSize)}`);
  console.log(`   Page bundles:      ${formatBytes(pageSize)} (${pages.length} files)`);
  console.log(`   Shared chunks:     ${formatBytes(chunkSize)} (${chunks.length} files)`);
  console.log(`   Framework:         ${formatBytes(framework.reduce((s, f) => s + f.size, 0))}`);
  console.log(`   Webpack runtime:   ${formatBytes(webpack.reduce((s, f) => s + f.size, 0))}`);

  // Check thresholds
  console.log('\n⚠️  Threshold Checks:');
  let hasWarnings = false;

  if (totalSize / 1024 > THRESHOLDS.total) {
    console.log(`   ❌ Total size exceeds ${THRESHOLDS.total} KB`);
    hasWarnings = true;
  } else {
    console.log(`   ✅ Total size within ${THRESHOLDS.total} KB limit`);
  }

  if (chunkSize / 1024 > THRESHOLDS.shared) {
    console.log(`   ⚠️  Shared chunks exceed ${THRESHOLDS.shared} KB`);
    hasWarnings = true;
  } else {
    console.log(`   ✅ Shared chunks within ${THRESHOLDS.shared} KB limit`);
  }

  // Largest files
  console.log('\n📈 Largest Bundles:');
  const sorted = [...jsFiles].sort((a, b) => b.size - a.size).slice(0, 10);

  sorted.forEach((file, index) => {
    const relativePath = file.path.replace(STATIC_DIR + '/', '');
    const warning = file.size / 1024 > THRESHOLDS.page ? ' ⚠️' : '';
    console.log(`   ${index + 1}. ${formatBytes(file.size).padEnd(12)} ${relativePath}${warning}`);
  });

  // Optimization suggestions
  if (hasWarnings) {
    console.log('\n💡 Optimization Suggestions:');
    console.log('   • Review large bundles and consider code splitting');
    console.log('   • Use dynamic imports for heavy components');
    console.log('   • Check if all dependencies are necessary');
    console.log('   • Use Next.js bundle analyzer: ANALYZE=true pnpm build');
    console.log('   • Consider lazy loading for non-critical features');
  }

  console.log('\n' + '='.repeat(70) + '\n');

  if (hasWarnings) {
    console.log('⚠️  Some bundles exceed recommended sizes.\n');
    process.exit(1);
  } else {
    console.log('✅ All bundles within recommended sizes.\n');
  }
}

// Run analysis
analyzeBundles();
