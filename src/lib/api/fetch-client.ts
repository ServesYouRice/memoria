/**
 * Client-side fetch wrapper for internal API calls.
 *
 * - Attaches the HTTP status to thrown errors so callers (and the global
 *   TanStack Query retry policy) can distinguish client errors (4xx) from
 *   transient server/network failures.
 * - On 401, redirects the browser to the sign-in page with a callbackUrl so
 *   an expired session doesn't leave the UI silently failing.
 *
 * @module lib/api/fetch-client
 */

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** True for errors that won't succeed on retry (4xx client errors). */
export function isClientError(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

let redirectingToLogin = false;

function redirectToLogin() {
  if (typeof window === "undefined" || redirectingToLogin) return;

  const { pathname, search } = window.location;
  // Never bounce the auth pages themselves.
  if (pathname.startsWith("/auth/")) return;

  redirectingToLogin = true;
  const callbackUrl = encodeURIComponent(pathname + search);
  window.location.assign(`/auth/login?callbackUrl=${callbackUrl}`);
}

async function extractErrorMessage(response: Response): Promise<string | null> {
  const payload = await response.json().catch(() => null);
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["detail", "message", "error"] as const) {
      if (typeof record[key] === "string" && record[key]) {
        return record[key] as string;
      }
    }
  }
  return null;
}

/**
 * Drop-in replacement for `fetch` against our own API routes.
 * Resolves with the response when it's OK; throws `ApiError` otherwise.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.ok) return response;

  const detail = await extractErrorMessage(response.clone());

  if (response.status === 401) {
    redirectToLogin();
    throw new ApiError(
      401,
      detail ?? "Your session has expired. Please sign in again.",
    );
  }

  throw new ApiError(
    response.status,
    detail ?? `Request failed with status ${response.status}`,
  );
}
