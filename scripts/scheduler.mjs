const baseUrl = process.env.SCHEDULER_BASE_URL || "http://app:3000";
const cronSecret = process.env.CRON_SECRET;
const intervalMs = Number(
  process.env.BOOKMARK_REFRESH_INTERVAL_MS || 15 * 60 * 1000,
);
// IMP-046: automatic version snapshots run on a shorter cadence than the
// maintenance sweep; the route deduplicates per five-minute bucket.
const versionIntervalMs = Number(
  process.env.VERSION_HISTORY_INTERVAL_MS || 5 * 60 * 1000,
);

if (!cronSecret) {
  throw new Error("CRON_SECRET is required for the scheduler");
}
if (!Number.isFinite(intervalMs) || intervalMs < 60_000) {
  throw new Error("BOOKMARK_REFRESH_INTERVAL_MS must be at least 60000");
}
if (!Number.isFinite(versionIntervalMs) || versionIntervalMs < 60_000) {
  throw new Error("VERSION_HISTORY_INTERVAL_MS must be at least 60000");
}

let stopping = false;
process.once("SIGTERM", () => {
  stopping = true;
});
process.once("SIGINT", () => {
  stopping = true;
});

const wait = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const tasks = [
  {
    paths: ["/api/cron/refresh-bookmarks", "/api/cron/maintenance"],
    everyMs: intervalMs,
    dueAt: 0,
  },
  {
    paths: ["/api/cron/version-history"],
    everyMs: versionIntervalMs,
    dueAt: 0,
  },
];

async function call(path) {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { authorization: `Bearer ${cronSecret}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      console.error(`${path} failed with HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(
      `${path} failed:`,
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

while (!stopping) {
  const now = Date.now();
  for (const task of tasks) {
    if (task.dueAt > now) continue;
    for (const path of task.paths) await call(path);
    task.dueAt = Date.now() + task.everyMs;
  }
  const nextDueAt = Math.min(...tasks.map((task) => task.dueAt));
  // Wake at least every second so a stop signal is noticed promptly.
  await wait(Math.min(1_000, Math.max(0, nextDueAt - Date.now())));
}
