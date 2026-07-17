const baseUrl = process.env.SCHEDULER_BASE_URL || 'http://app:3000';
const cronSecret = process.env.CRON_SECRET;
const intervalMs = Number(process.env.BOOKMARK_REFRESH_INTERVAL_MS || 15 * 60 * 1000);

if (!cronSecret) {
  throw new Error('CRON_SECRET is required for the scheduler');
}
if (!Number.isFinite(intervalMs) || intervalMs < 60_000) {
  throw new Error('BOOKMARK_REFRESH_INTERVAL_MS must be at least 60000');
}

let stopping = false;
process.once('SIGTERM', () => {
  stopping = true;
});
process.once('SIGINT', () => {
  stopping = true;
});

const wait = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

while (!stopping) {
  try {
    const response = await fetch(`${baseUrl}/api/cron/refresh-bookmarks`, {
      headers: { authorization: `Bearer ${cronSecret}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      console.error(`Bookmark refresh failed with HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(
      'Bookmark refresh failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
  }
  await wait(intervalMs);
}
