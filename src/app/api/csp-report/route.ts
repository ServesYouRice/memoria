/**
 * CSP Violation Report Endpoint
 *
 * Receives Content Security Policy violation reports from browsers.
 * These reports help identify XSS attempts and misconfigured CSP directives.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

interface CSPViolationReport {
    'csp-report': {
        'document-uri': string;
        'referrer': string;
        'violated-directive': string;
        'effective-directive': string;
        'original-policy': string;
        'disposition': string;
        'blocked-uri': string;
        'line-number'?: number;
        'column-number'?: number;
        'source-file'?: string;
        'status-code': number;
        'script-sample'?: string;
    };
}

export async function POST(request: NextRequest) {
    try {
        const report: CSPViolationReport = await request.json();
        const cspReport = report['csp-report'];

        // Log the violation for security monitoring
        logger.warn({
            type: 'csp-violation',
            documentUri: cspReport['document-uri'],
            violatedDirective: cspReport['violated-directive'],
            effectiveDirective: cspReport['effective-directive'],
            blockedUri: cspReport['blocked-uri'],
            sourceFile: cspReport['source-file'],
            lineNumber: cspReport['line-number'],
            columnNumber: cspReport['column-number'],
            scriptSample: cspReport['script-sample'],
        }, 'CSP violation detected');

        // In production, you might want to:
        // 1. Send to Sentry or other error tracking
        // 2. Store in database for analysis
        // 3. Alert on high-severity violations

        return new NextResponse(null, { status: 204 });
    } catch (error) {
        // Don't expose errors for CSP reports
        logger.error({ error }, 'Failed to process CSP report');
        return new NextResponse(null, { status: 204 });
    }
}
