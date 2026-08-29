import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "node",
    globals: true,
    // env.ts validates process.env at module scope, so AUTH_URL/AUTH_SECRET
    // have to exist before a suite imports its module graph. tests/setup.ts
    // defers to any value already set, so the real TEST_DATABASE_URL this
    // suite runs against still wins.
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
