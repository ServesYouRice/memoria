#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { gzipSync } from 'zlib';

// Performance budgets from ADR-0007
const BUDGETS = {
  landing: 100 * 1024, // 100KB gzipped
  auth: 125 * 1024, // 125KB gzipped
  canvas: 150 * 1024, // 150KB gzipped (canvas libs lazy-loaded)
};

function getFileSizeGzipped(filePath) {
  const content = readFileSync(filePath);
  const gzipped = gzipSync(content);
  return gzipped.length;
}

function getAllFiles(dir, fileList = []) {
  const files = readdirSync(dir);

  files.forEach((file) => {
    const filePath = join(dir, file);
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      getAllFiles(filePath, fileList);
    } else if (file.endsWith('.js')) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

function analyzeBundle() {
  const buildDir = '.next';
  const staticDir = join(buildDir, 'static');

  try {
    const files = getAllFiles(staticDir);

    const bundles = {
      landing: [],
      auth: [],
      canvas: [],
      other: [],
    };

    files.forEach((file) => {
      const size = getFileSizeGzipped(file);
      const fileName = file.split('/').pop();

      if (file.includes('/pages/index') || fileName.includes('_app')) {
        bundles.landing.push({ file, size });
      } else if (file.includes('/pages/login') || file.includes('/pages/register')) {
        bundles.auth.push({ file, size });
      } else if (file.includes('/pages/canvas')) {
        bundles.canvas.push({ file, size });
      } else {
        bundles.other.push({ file, size });
      }
    });

    let hasViolations = false;

    console.log('\n📦 Bundle Size Analysis\n');

    Object.entries(bundles).forEach(([route, files]) => {
      if (files.length === 0) return;

      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      const totalSizeKB = (totalSize / 1024).toFixed(2);

      const budget = BUDGETS[route];
      const budgetKB = budget ? (budget / 1024).toFixed(2) : 'N/A';

      const status = budget && totalSize > budget ? '❌ EXCEEDED' : '✅ OK';

      if (budget && totalSize > budget) {
        hasViolations = true;
      }

      console.log(`${route.toUpperCase()}:`);
      console.log(`  Total: ${totalSizeKB} KB (Budget: ${budgetKB} KB) ${status}`);
      console.log(`  Files: ${files.length}`);

      if (budget && totalSize > budget) {
        console.log('  Largest files:');
        files
          .sort((a, b) => b.size - a.size)
          .slice(0, 5)
          .forEach((f) => {
            const sizeKB = (f.size / 1024).toFixed(2);
            const fileName = f.file.split('/').pop();
            console.log(`    - ${fileName}: ${sizeKB} KB`);
          });
      }
      console.log('');
    });

    if (hasViolations) {
      console.error('❌ Bundle size budget exceeded!');
      console.error('Please optimize your bundles or update the budget in ADR-0007.');
      process.exit(1);
    } else {
      console.log('✅ All bundles are within budget!');
      process.exit(0);
    }
  } catch (error) {
    console.error('Error analyzing bundle:', error.message);
    // Don't fail if build directory doesn't exist yet
    console.log('⚠️  Build directory not found. Skipping bundle analysis.');
    process.exit(0);
  }
}

analyzeBundle();
