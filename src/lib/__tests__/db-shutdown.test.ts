import { afterEach, describe, expect, it, vi } from "vitest";

const disconnect = vi.fn(async () => undefined);

vi.mock("@/generated/prisma/client", () => ({
  PrismaClient: class {
    $connect = vi.fn(async () => undefined);
    $disconnect = disconnect;
    $on = vi.fn();
  },
}));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class {} }));

describe("db.ts production shutdown ownership", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("registers no SIGTERM/SIGINT listener, so server.ts owns the drain", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MEMORIA_SKIP_DB_EAGER_CONNECT", "true");
    const before = {
      SIGTERM: process.listeners("SIGTERM"),
      SIGINT: process.listeners("SIGINT"),
      beforeExit: process.listeners("beforeExit"),
    };
    const db = await import("../db");
    const added = (signal: "SIGTERM" | "SIGINT" | "beforeExit") =>
      process.listeners(signal).filter((l) => !before[signal].includes(l));
    try {
      expect(added("SIGTERM")).toHaveLength(0);
      expect(added("SIGINT")).toHaveLength(0);
      expect(typeof db.disconnectDatabase).toBe("function");
      await db.disconnectDatabase();
      await db.disconnectDatabase();
      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally {
      for (const signal of ["SIGTERM", "SIGINT", "beforeExit"] as const) {
        for (const l of added(signal)) process.off(signal, l);
      }
    }
  });
});
