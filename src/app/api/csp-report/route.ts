/**
 * CSP Violation Report Endpoint
 *
 * Receives Content Security Policy violation reports from browsers.
 * These reports help identify XSS attempts and misconfigured CSP directives.
 */

import { type NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { z } from "zod";

const MAX_REPORT_BYTES = 16 * 1024;
const boundedString = z.string().max(2048).default("");
const cspViolationSchema = z
  .object({
    "csp-report": z
      .object({
        "document-uri": boundedString,
        "violated-directive": z.string().max(256),
        "effective-directive": z.string().max(256).optional(),
        "blocked-uri": boundedString.optional(),
        "source-file": boundedString.optional(),
        "line-number": z.number().int().nonnegative().optional(),
        "column-number": z.number().int().nonnegative().optional(),
      })
      .strip(),
  })
  .strip();

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REPORT_BYTES) {
      return new NextResponse(null, { status: 413 });
    }
    const report = cspViolationSchema.parse(JSON.parse(rawBody));
    const cspReport = report["csp-report"];

    // Log the violation for security monitoring
    logger.warn(
      {
        type: "csp-violation",
        documentUri: cspReport["document-uri"],
        violatedDirective: cspReport["violated-directive"],
        effectiveDirective: cspReport["effective-directive"],
        blockedUri: cspReport["blocked-uri"],
        sourceFile: cspReport["source-file"],
        lineNumber: cspReport["line-number"],
        columnNumber: cspReport["column-number"],
      },
      "CSP violation detected",
    );

    // In production, you might want to:
    // 1. Send to Sentry or other error tracking
    // 2. Store in database for analysis
    // 3. Alert on high-severity violations

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    // Don't expose errors for CSP reports
    logger.error({ error }, "Failed to process CSP report");
    return new NextResponse(null, { status: 204 });
  }
}
