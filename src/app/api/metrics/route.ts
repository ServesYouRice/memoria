/**
 * Prometheus-compatible process and application metrics.
 *
 * The app does not keep an in-process metrics registry yet, so this endpoint
 * exposes only measurements collected by this process. Application counters
 * are omitted until real request instrumentation is wired in.
 */

import { NextResponse } from "next/server";
import { hasInternalOperationsAccess } from "@/lib/operations/internal-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function metricHelp(name: string, description: string): string {
  return `# HELP ${name} ${description}`;
}

function metricType(
  name: string,
  type: "counter" | "gauge" | "histogram",
): string {
  return `# TYPE ${name} ${type}`;
}

function metric(name: string, value: number): string {
  return `${name} ${Number.isFinite(value) ? value : 0}`;
}

export async function GET(request: Request) {
  if (!hasInternalOperationsAccess(request)) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  const cpuUsage = process.cpuUsage();
  const memory = process.memoryUsage();
  const uptime = process.uptime();
  let oldestPending: { nextRunAt: Date } | null = null;
  let deadJobs = 0;
  let outboxMetricsAvailable = 1;
  try {
    [oldestPending, deadJobs] = await Promise.all([
      prisma.outboxJob.findFirst({
        where: { status: "PENDING" },
        orderBy: { nextRunAt: "asc" },
        select: { nextRunAt: true },
      }),
      prisma.outboxJob.count({ where: { status: "DEAD" } }),
    ]);
  } catch {
    // Process metrics must remain scrapeable during a database outage.
    outboxMetricsAvailable = 0;
  }
  const queueAge = oldestPending
    ? Math.max(0, (Date.now() - oldestPending.nextRunAt.getTime()) / 1000)
    : 0;

  const lines = [
    metricHelp(
      "process_cpu_user_seconds_total",
      "Total user CPU time spent in seconds.",
    ),
    metricType("process_cpu_user_seconds_total", "counter"),
    metric("process_cpu_user_seconds_total", cpuUsage.user / 1_000_000),
    "",
    metricHelp(
      "process_cpu_system_seconds_total",
      "Total system CPU time spent in seconds.",
    ),
    metricType("process_cpu_system_seconds_total", "counter"),
    metric("process_cpu_system_seconds_total", cpuUsage.system / 1_000_000),
    "",
    metricHelp(
      "process_start_time_seconds",
      "Start time of the process since Unix epoch in seconds.",
    ),
    metricType("process_start_time_seconds", "gauge"),
    metric(
      "process_start_time_seconds",
      Math.floor(Date.now() / 1000 - uptime),
    ),
    "",
    metricHelp(
      "nodejs_heap_size_total_bytes",
      "Process V8 heap size total in bytes.",
    ),
    metricType("nodejs_heap_size_total_bytes", "gauge"),
    metric("nodejs_heap_size_total_bytes", memory.heapTotal),
    "",
    metricHelp(
      "nodejs_heap_size_used_bytes",
      "Process V8 heap size used in bytes.",
    ),
    metricType("nodejs_heap_size_used_bytes", "gauge"),
    metric("nodejs_heap_size_used_bytes", memory.heapUsed),
    "",
    metricHelp(
      "nodejs_external_memory_bytes",
      "Node.js external memory size in bytes.",
    ),
    metricType("nodejs_external_memory_bytes", "gauge"),
    metric("nodejs_external_memory_bytes", memory.external),
    "",
    metricHelp(
      "memoria_outbox_oldest_pending_seconds",
      "Age of the oldest runnable outbox job.",
    ),
    metricType("memoria_outbox_oldest_pending_seconds", "gauge"),
    metric("memoria_outbox_oldest_pending_seconds", queueAge),
    "",
    metricHelp(
      "memoria_outbox_dead_jobs",
      "Number of outbox jobs requiring operator action.",
    ),
    metricType("memoria_outbox_dead_jobs", "gauge"),
    metric("memoria_outbox_dead_jobs", deadJobs),
    "",
    metricHelp(
      "memoria_outbox_metrics_available",
      "Whether outbox metrics were collected successfully.",
    ),
    metricType("memoria_outbox_metrics_available", "gauge"),
    metric("memoria_outbox_metrics_available", outboxMetricsAvailable),
  ];

  return new NextResponse(`${lines.join("\n")}\n`, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
