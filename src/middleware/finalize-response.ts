import type { NextRequest, NextResponse } from "next/server";
import { applyCors } from "./cors";
import { applyCSP, generateNonce } from "./csp";
import { applySecurityHeaders } from "./security-headers";

/**
 * Give a response that proxy() returns before NextResponse.next() (rate-limit
 * 429s, the unsupported-version 400) the headers the success path sets: the
 * request id, CORS for allowed origins, the security headers and a CSP. Early
 * responses are never framed, so frame-ancestors stays 'none'. Status, body
 * and the rate-limit headers are left as they are.
 */
export function finalizeEarlyResponse(
  request: NextRequest,
  response: NextResponse,
  requestId: string,
): NextResponse {
  response.headers.set("x-request-id", requestId);
  applyCors(request, response);
  applySecurityHeaders(response);
  applyCSP(response, generateNonce());
  return response;
}
