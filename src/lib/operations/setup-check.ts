import { defaultChecks, runWithDeadline } from "@/lib/operations/readiness";
import { SETUP_CHECKS, type SetupCheckName } from "./setup-fixes.mjs";

/**
 * The set-up check (IMP-100): each part Memoria needs, whether it answers,
 * and the fix in plain words when it does not. The live connection through
 * the owner's proxy is checked by the browser on the first-run page and by
 * `pnpm doctor`, since only a request from outside crosses that proxy.
 */

export interface SetupCheckResult {
  name: SetupCheckName;
  label: string;
  ok: boolean;
  fix?: string;
}

const READINESS_NAMES = {
  database: "database",
  migrations: "migrations",
  redis: "redis",
  "upload-storage": "storage",
} as const satisfies Record<string, SetupCheckName>;

function syncServerUrl() {
  return (
    process.env.SYNC_SERVER_INTERNAL_URL || "http://127.0.0.1:3001"
  ).replace(/\/+$/, "");
}

async function checkSyncServer(fetchImpl: typeof fetch) {
  const response = await fetchImpl(`${syncServerUrl()}/ready`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`sync server answered ${response.status}`);
}

function result(name: SetupCheckName, ok: boolean): SetupCheckResult {
  const { label, fix } = SETUP_CHECKS[name];
  return ok ? { name, label, ok } : { name, label, ok, fix };
}

export async function runSetupChecks(
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<SetupCheckResult[]> {
  const timeoutMs = options.timeoutMs ?? 3_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const checks = [
    ...defaultChecks().map((check) => ({
      name: READINESS_NAMES[check.name] as SetupCheckName,
      run: check.run,
    })),
    {
      name: "sync-server" as const,
      run: () => checkSyncServer(fetchImpl),
    },
  ];
  const settled = await Promise.allSettled(
    checks.map((check) => runWithDeadline(check.run, timeoutMs)),
  );
  return checks.map((check, index) =>
    result(check.name, settled[index]?.status === "fulfilled"),
  );
}
