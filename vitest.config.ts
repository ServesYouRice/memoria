import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

function aliasesFromTsconfig(): { find: string; replacement: string }[] {
  const tsconfigPath = path.resolve(__dirname, 'tsconfig.json');
  const raw = fs.readFileSync(tsconfigPath, 'utf-8');
  const ts = JSON.parse(raw);
  const compilerOptions = ts.compilerOptions || {};
  const baseUrl = compilerOptions.baseUrl || '.';
  const paths: Record<string, string[]> = compilerOptions.paths || {};

  return Object.entries(paths).map(([key, values]) => {
    const find = key.replace(/\/\*$/, '');
    const target = values[0].replace(/\/\*$/, '');
    const replacement = path.resolve(__dirname, baseUrl, target);
    return { find, replacement };
  });
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: aliasesFromTsconfig(),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'e2e/',
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/*.config.ts',
        '**/*.config.js',
        '**/*.config.mjs',
        'scripts/**',
        'prisma/**',
        '.next/**',
        'src/types/**',
      ],
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
});
