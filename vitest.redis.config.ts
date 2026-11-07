import { defineConfig } from "vitest/config";
import path from "path";

// Real Redis/Valkey under the shared cluster's ACL (IMP-073). Run through
// `pnpm test:redis`, which starts the server and sets REDIS_ACL_TEST_URL.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/redis/**/*.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
