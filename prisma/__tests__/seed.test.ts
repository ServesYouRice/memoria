import { afterEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const model = (name: string) =>
  new Proxy(
    {},
    {
      get: (_t, op: string) =>
        vi.fn(async (args?: { data?: { email?: string } }) => {
          calls.push(`${name}.${op}`);
          if (op === "findUnique") return null;
          if (op === "count") return 0;
          return { id: `${name}-${calls.length}`, email: args?.data?.email };
        }),
    },
  );

vi.mock("../../src/generated/prisma/client", () => ({
  PrismaClient: class {
    user = model("user");
    canvas = model("canvas");
    canvasItem = model("canvasItem");
    session = model("session");
    account = model("account");
    $disconnect = vi.fn(async () => undefined);
  },
}));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class {} }));
const hashPassword = vi.fn(async () => "hash");
vi.mock("../../src/lib/auth/password", () => ({ hashPassword }));
vi.mock("../../src/lib/auth/credentials", () => ({
  createCredentialAccount: vi.fn(async () => calls.push("credential")),
}));

describe("prisma/seed.ts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
    calls.length = 0;
  });

  it("refuses NODE_ENV=production before any hashing or write", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const exited = new Promise<number | undefined>((resolve) => {
      vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
        resolve(code);
      }) as never);
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await import("../seed");
    const code = await Promise.race([
      exited,
      new Promise<string>((resolve) =>
        setTimeout(() => resolve("no-exit"), 500),
      ),
    ]);
    expect(code).toBe(1);
    expect(hashPassword).not.toHaveBeenCalled();
    expect(
      calls.filter((c) => /\.(create|delete|update|upsert)/.test(c)),
    ).toEqual([]);
  });
});
