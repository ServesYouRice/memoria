/**
 * IMP-151 — the browser's Sentry address, read at request time.
 *
 * The server renders `SENTRY_BROWSER_DSN` (and optionally
 * `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE`) into the root layout as `<meta>`
 * tags, and `src/instrumentation-client.ts` reads them. Nothing is inlined at
 * build time, so one image serves staging and production. Without a valid
 * DSN no tag is rendered and the browser loads no Sentry code (IMP-116).
 *
 * This module is shared by the server layout and the client entry, so it
 * must stay free of server-only imports.
 *
 * @module lib/telemetry/browser-sentry
 */

export const BROWSER_SENTRY_META = {
  dsn: "memoria-sentry-dsn",
  environment: "memoria-sentry-environment",
  release: "memoria-sentry-release",
} as const;

export interface BrowserSentryConfig {
  dsn: string;
  environment?: string;
  release?: string;
}

type SentryEnv = Record<string, string | undefined>;

/** A DSN the browser SDK can post to: an absolute http(s) URL. */
export function parseSentryDsn(value: string | undefined): URL | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Server side: the browser Sentry config for this process, or null when
 * browser telemetry is off (not production, or no valid browser DSN).
 */
export function getBrowserSentryConfig(
  env: SentryEnv = process.env,
): BrowserSentryConfig | null {
  if (env.NODE_ENV !== "production") return null;
  const dsn = parseSentryDsn(env.SENTRY_BROWSER_DSN);
  if (!dsn) return null;
  const environment = env.SENTRY_ENVIRONMENT?.trim();
  const release = env.SENTRY_RELEASE?.trim();
  return {
    dsn: dsn.toString(),
    ...(environment ? { environment } : {}),
    ...(release ? { release } : {}),
  };
}

/** Client side: the config the server rendered into the page, if any. */
export function readBrowserSentryConfig(
  doc: Pick<Document, "querySelector">,
): BrowserSentryConfig | null {
  const read = (name: string) =>
    doc
      .querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
      ?.content.trim() || undefined;
  const dsn = parseSentryDsn(read(BROWSER_SENTRY_META.dsn));
  if (!dsn) return null;
  const environment = read(BROWSER_SENTRY_META.environment);
  const release = read(BROWSER_SENTRY_META.release);
  return {
    dsn: dsn.toString(),
    ...(environment ? { environment } : {}),
    ...(release ? { release } : {}),
  };
}
