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
  readonly problemType?: string;
  readonly code?: string;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    message: string,
    options?: {
      problemType?: string;
      code?: string;
      requestId?: string;
      retryAfterSeconds?: number;
    },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.problemType = options?.problemType;
    this.code = options?.code;
    this.requestId = options?.requestId;
    this.retryAfterSeconds = options?.retryAfterSeconds;
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

async function extractProblem(response: Response): Promise<{
  message: string | null;
  problemType?: string;
  code?: string;
}> {
  const payload = await response.json().catch(() => null);
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const extensions =
      record.extensions && typeof record.extensions === "object"
        ? (record.extensions as Record<string, unknown>)
        : undefined;
    for (const key of ["detail", "message", "error"] as const) {
      if (typeof record[key] === "string" && record[key]) {
        return {
          message: record[key] as string,
          problemType:
            typeof record.type === "string" ? record.type : undefined,
          code:
            typeof record.code === "string"
              ? record.code
              : typeof extensions?.code === "string"
                ? extensions.code
                : undefined,
        };
      }
    }
  }
  return { message: null };
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

  const problem = await extractProblem(response.clone());
  const parsedRetryAfter = Number.parseInt(
    response.headers.get("retry-after") || "",
    10,
  );
  const metadata = {
    ...problem,
    requestId: response.headers.get("x-request-id") || undefined,
    retryAfterSeconds: Number.isFinite(parsedRetryAfter)
      ? Math.max(0, parsedRetryAfter)
      : undefined,
  };

  if (response.status === 401) {
    redirectToLogin();
    throw new ApiError(
      401,
      problem.message ?? "Your session has expired. Please sign in again.",
      metadata,
    );
  }

  throw new ApiError(
    response.status,
    problem.message ?? `Request failed with status ${response.status}`,
    metadata,
  );
}

export function isVersionConflict(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 409 ||
      error.code === "VERSION_CONFLICT" ||
      error.problemType?.endsWith("/version-conflict") === true)
  );
}
