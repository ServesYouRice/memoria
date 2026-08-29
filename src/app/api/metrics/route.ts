import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hasInternalOperationsAccess } from "@/lib/operations/internal-auth";
import { evaluateReadiness } from "@/lib/operations/readiness";
import {
  OPERATIONAL_COUNTERS,
  readBackupSuccessTimestamp,
  readOperationalCounters,
  readOperationalGauges,
} from "@/lib/operations/runtime-metrics";

export const dynamic = "force-dynamic";

function metricHelp(name: string, description: string): string {
  return `# HELP ${name} ${description}`;
}

function metricType(name: string, type: "counter" | "gauge"): string {
  return `# TYPE ${name} ${type}`;
}

function metric(name: string, value: number): string {
  return `${name} ${Number.isFinite(value) ? value : 0}`;
}

function metricBlock(
  name: string,
  description: string,
  type: "counter" | "gauge",
  value: number,
): string[] {
  return [
    metricHelp(name, description),
    metricType(name, type),
    metric(name, value),
    "",
  ];
}

export async function GET(request: Request) {
  if (!hasInternalOperationsAccess(request)) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  const cpuUsage = process.cpuUsage();
  const memory = process.memoryUsage();
  const uptime = process.uptime();
  const [readiness, counters, backupLastSuccess] = await Promise.all([
    evaluateReadiness(),
    readOperationalCounters(),
    readBackupSuccessTimestamp(),
  ]);
  const gauges = readOperationalGauges();

  let oldestPending: { nextRunAt: Date } | null = null;
  let deadJobs = 0;
  let aiActions24h = 0;
  let databaseMetricsAvailable = 1;
  try {
    [oldestPending, deadJobs, aiActions24h] = await Promise.all([
      prisma.outboxJob.findFirst({
        where: { status: "PENDING" },
        orderBy: { nextRunAt: "asc" },
        select: { nextRunAt: true },
      }),
      prisma.outboxJob.count({ where: { status: "DEAD" } }),
      prisma.agentAction.count({
        where: {
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1_000) },
        },
      }),
    ]);
  } catch {
    // Process and shared counters remain scrapeable during a database outage.
    databaseMetricsAvailable = 0;
  }

  const queueAge = oldestPending
    ? Math.max(0, (Date.now() - oldestPending.nextRunAt.getTime()) / 1_000)
    : 0;
  const backupAge = backupLastSuccess
    ? Math.max(0, Date.now() / 1_000 - backupLastSuccess)
    : 0;
  const configuredAiBudget = Number(
    process.env.AI_ACTION_BUDGET_DAILY || 1_000,
  );
  const aiBudget =
    Number.isFinite(configuredAiBudget) && configuredAiBudget > 0
      ? configuredAiBudget
      : 1_000;
  const readinessCheck = (name: string) =>
    readiness.checks.find((check) => check.name === name)?.status === "ok"
      ? 1
      : 0;

  const lines = [
    ...metricBlock(
      "process_cpu_user_seconds_total",
      "Total user CPU time spent in seconds.",
      "counter",
      cpuUsage.user / 1_000_000,
    ),
    ...metricBlock(
      "process_cpu_system_seconds_total",
      "Total system CPU time spent in seconds.",
      "counter",
      cpuUsage.system / 1_000_000,
    ),
    ...metricBlock(
      "process_start_time_seconds",
      "Start time of the process since Unix epoch in seconds.",
      "gauge",
      Math.floor(Date.now() / 1_000 - uptime),
    ),
    ...metricBlock(
      "nodejs_heap_size_total_bytes",
      "Process V8 heap size total in bytes.",
      "gauge",
      memory.heapTotal,
    ),
    ...metricBlock(
      "nodejs_heap_size_used_bytes",
      "Process V8 heap size used in bytes.",
      "gauge",
      memory.heapUsed,
    ),
    ...metricBlock(
      "nodejs_external_memory_bytes",
      "Node.js external memory size in bytes.",
      "gauge",
      memory.external,
    ),
    ...metricBlock(
      "memoria_readiness_ready",
      "Whether traffic-critical readiness checks currently pass.",
      "gauge",
      readiness.status === "unavailable" ? 0 : 1,
    ),
    ...metricBlock(
      "memoria_database_available",
      "Whether the database readiness check currently passes.",
      "gauge",
      readinessCheck("database"),
    ),
    ...metricBlock(
      "memoria_redis_available",
      "Whether the Redis readiness check currently passes.",
      "gauge",
      readinessCheck("redis"),
    ),
    ...metricBlock(
      "memoria_storage_available",
      "Whether private upload storage is currently available.",
      "gauge",
      readinessCheck("upload-storage"),
    ),
    ...metricBlock(
      "memoria_outbox_oldest_pending_seconds",
      "Age of the oldest runnable outbox job.",
      "gauge",
      queueAge,
    ),
    ...metricBlock(
      "memoria_outbox_dead_jobs",
      "Number of outbox jobs requiring operator action.",
      "gauge",
      deadJobs,
    ),
    ...metricBlock(
      "memoria_database_metrics_available",
      "Whether database-backed operations metrics were collected successfully.",
      "gauge",
      databaseMetricsAvailable,
    ),
    ...metricBlock(
      "memoria_websocket_connections",
      "Current local collaboration WebSocket connections.",
      "gauge",
      gauges.websocket_connections,
    ),
    ...metricBlock(
      "memoria_websocket_active_canvases",
      "Current local canvases with collaboration connections.",
      "gauge",
      gauges.websocket_active_canvases,
    ),
    ...metricBlock(
      "memoria_backup_last_success_timestamp_seconds",
      "Unix timestamp of the latest verified off-host backup.",
      "gauge",
      backupLastSuccess,
    ),
    ...metricBlock(
      "memoria_backup_age_seconds",
      "Age in seconds of the latest verified off-host backup.",
      "gauge",
      backupAge,
    ),
    ...metricBlock(
      "memoria_ai_actions_24h",
      "Agent actions created during the trailing 24 hours.",
      "gauge",
      aiActions24h,
    ),
    ...metricBlock(
      "memoria_ai_action_budget_daily",
      "Configured daily agent-action operations budget.",
      "gauge",
      aiBudget,
    ),
    ...metricBlock(
      "memoria_ai_action_budget_utilization_ratio",
      "Trailing 24-hour agent actions divided by the configured daily budget.",
      "gauge",
      aiActions24h / aiBudget,
    ),
  ];

  const counterDescriptions: Record<
    (typeof OPERATIONAL_COUNTERS)[number],
    string
  > = {
    http_4xx_total: "HTTP client-error responses observed by the application.",
    http_5xx_total: "HTTP server-error responses observed by the application.",
    redis_safety_failures_total:
      "Redis failures that degraded login, rate-limit, or safety enforcement.",
    websocket_rejected_total: "Rejected collaboration WebSocket connections.",
    outbox_poll_failures_total: "Outbox database claim failures.",
    outbox_handler_timeouts_total: "Outbox handlers aborted at their deadline.",
    outbox_lease_lost_total: "Outbox jobs that lost lease ownership.",
    email_delivery_failures_total: "Email provider delivery failures.",
    backup_freshness_failures_total:
      "Independent backup freshness check failures.",
    ai_requests_total: "AI requests admitted by per-user safety budgets.",
    ai_budget_rejections_total:
      "AI requests rejected by token, cost, or concurrency budgets.",
    ai_reserved_tokens_total:
      "Worst-case AI tokens atomically reserved before provider calls.",
    ai_reserved_cost_micro_usd_total:
      "Worst-case AI cost reserved before provider calls, in micro-US dollars.",
    account_exports_completed_total:
      "Background account archives completed successfully.",
    account_exports_failed_total:
      "Background account archive attempts that failed.",
    account_exports_cancelled_total:
      "Background account archives cancelled by their owner.",
    account_export_bytes_total:
      "Compressed bytes written by completed account archives.",
  };
  for (const name of OPERATIONAL_COUNTERS) {
    lines.push(
      ...metricBlock(
        `memoria_${name}`,
        counterDescriptions[name],
        "counter",
        counters[name],
      ),
    );
  }

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
