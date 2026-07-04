/**
 * Prometheus-compatible process and application metrics.
 *
 * The app does not keep an in-process metrics registry yet, so this endpoint
 * exposes runtime gauges plus zero-valued application counters as a stable
 * scraping contract until request instrumentation is wired in.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function metricHelp(name: string, description: string): string {
  return `# HELP ${name} ${description}`;
}

function metricType(
  name: string,
  type: 'counter' | 'gauge' | 'histogram'
): string {
  return `# TYPE ${name} ${type}`;
}

function metric(name: string, value: number): string {
  return `${name} ${Number.isFinite(value) ? value : 0}`;
}

export async function GET() {
  const cpuUsage = process.cpuUsage();
  const memory = process.memoryUsage();
  const uptime = process.uptime();

  const lines = [
    metricHelp('process_cpu_user_seconds_total', 'Total user CPU time spent in seconds.'),
    metricType('process_cpu_user_seconds_total', 'counter'),
    metric('process_cpu_user_seconds_total', cpuUsage.user / 1_000_000),
    '',
    metricHelp('process_cpu_system_seconds_total', 'Total system CPU time spent in seconds.'),
    metricType('process_cpu_system_seconds_total', 'counter'),
    metric('process_cpu_system_seconds_total', cpuUsage.system / 1_000_000),
    '',
    metricHelp('process_start_time_seconds', 'Start time of the process since Unix epoch in seconds.'),
    metricType('process_start_time_seconds', 'gauge'),
    metric('process_start_time_seconds', Math.floor(Date.now() / 1000 - uptime)),
    '',
    metricHelp('nodejs_heap_size_total_bytes', 'Process V8 heap size total in bytes.'),
    metricType('nodejs_heap_size_total_bytes', 'gauge'),
    metric('nodejs_heap_size_total_bytes', memory.heapTotal),
    '',
    metricHelp('nodejs_heap_size_used_bytes', 'Process V8 heap size used in bytes.'),
    metricType('nodejs_heap_size_used_bytes', 'gauge'),
    metric('nodejs_heap_size_used_bytes', memory.heapUsed),
    '',
    metricHelp('nodejs_external_memory_bytes', 'Node.js external memory size in bytes.'),
    metricType('nodejs_external_memory_bytes', 'gauge'),
    metric('nodejs_external_memory_bytes', memory.external),
    '',
    metricHelp('canvascollect_http_requests_total', 'Total observed HTTP requests.'),
    metricType('canvascollect_http_requests_total', 'counter'),
    metric('canvascollect_http_requests_total', 0),
    '',
    metricHelp(
      'canvascollect_http_request_duration_seconds',
      'Observed HTTP request duration in seconds.'
    ),
    metricType('canvascollect_http_request_duration_seconds', 'gauge'),
    metric('canvascollect_http_request_duration_seconds', 0),
    '',
    metricHelp('canvascollect_canvas_operations_total', 'Total observed canvas operations.'),
    metricType('canvascollect_canvas_operations_total', 'counter'),
    metric('canvascollect_canvas_operations_total', 0),
  ];

  return new NextResponse(`${lines.join('\n')}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}
