import { NextResponse } from 'next/server';
import { register, collectDefaultMetrics, Counter, Histogram } from 'prom-client';

// Initialize default metrics collection
collectDefaultMetrics({ prefix: 'canvascollect_' });

// Custom application metrics
export const httpRequestDuration = new Histogram({
  name: 'canvascollect_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
});

export const httpRequestTotal = new Counter({
  name: 'canvascollect_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

export const canvasOperations = new Counter({
  name: 'canvascollect_canvas_operations_total',
  help: 'Total number of canvas operations',
  labelNames: ['operation', 'item_type'],
});

export const authAttempts = new Counter({
  name: 'canvascollect_auth_attempts_total',
  help: 'Total number of authentication attempts',
  labelNames: ['method', 'result'],
});

export const databaseQueryDuration = new Histogram({
  name: 'canvascollect_db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation'],
});

export async function GET() {
  try {
    const metrics = await register.metrics();

    return new NextResponse(metrics, {
      status: 200,
      headers: {
        'Content-Type': register.contentType,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to collect metrics' }, { status: 500 });
  }
}
