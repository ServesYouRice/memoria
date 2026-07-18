/**
 * Health Check Endpoint
 *
 * ENHANCED: Issue #28 - Detailed health checks
 *
 * Returns comprehensive health status including:
 * - Database connectivity and response time
 * - Memory usage and limits
 * - System uptime
 * - Application version
 */

import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { API_VERSION } from "@/lib/api/versioning";
import { getRedisClient } from "@/lib/cache/redis-client";
import { checkPrivateUploadStorage } from "@/lib/uploads/private-storage";

const logger = createLogger("health");

// Track when the application started
const startTime = Date.now();

interface HealthCheck {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database: {
      status: "pass" | "fail";
      responseTime?: number;
      error?: string;
    };
    redis: {
      status: "pass" | "fail" | "skip";
      responseTime?: number;
      error?: string;
    };
    storage: {
      status: "pass" | "fail" | "skip";
      responseTime?: number;
      error?: string;
    };
    migrations: {
      status: "pass" | "fail";
      error?: string;
    };
    memory: {
      status: "pass" | "warn" | "fail";
      used: number;
      total: number;
      percentage: number;
      rss: number;
      external: number;
    };
  };
}

async function checkStorage(): Promise<HealthCheck["checks"]["storage"]> {
  if (
    process.env.UPLOAD_STORAGE !== "s3" &&
    process.env.NODE_ENV !== "production"
  ) {
    return { status: "skip" };
  }
  const start = Date.now();
  try {
    await Promise.race([
      checkPrivateUploadStorage(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("storage timeout")), 3000),
      ),
    ]);
    return { status: "pass", responseTime: Date.now() - start };
  } catch (error) {
    logger.error({ error }, "Storage health check failed");
    return { status: "fail", error: "storage_unavailable" };
  }
}

async function checkMigrations(): Promise<HealthCheck["checks"]["migrations"]> {
  try {
    const rows = await prisma.$queryRaw<Array<{ failed: number }>>`
      SELECT COUNT(*)::int AS "failed"
      FROM "_prisma_migrations"
      WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL
    `;
    return Number(rows[0]?.failed || 0) === 0
      ? { status: "pass" }
      : { status: "fail", error: "migration_incomplete" };
  } catch (error) {
    logger.error({ error }, "Migration health check failed");
    return { status: "fail", error: "migration_status_unavailable" };
  }
}

async function checkDatabase(): Promise<HealthCheck["checks"]["database"]> {
  const start = Date.now();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("database timeout")), 3000),
      ),
    ]);
    const responseTime = Date.now() - start;
    return { status: "pass", responseTime };
  } catch (error) {
    logger.error({ error }, "Database health check failed");
    return {
      status: "fail",
      error: "database_unavailable",
    };
  }
}

async function checkRedis(): Promise<HealthCheck["checks"]["redis"]> {
  const start = Date.now();
  const redis = getRedisClient();
  if (!redis) {
    return process.env.NODE_ENV === "production"
      ? { status: "fail", error: "redis_unavailable" }
      : { status: "skip", error: "redis_not_configured" };
  }
  try {
    await Promise.race([
      redis.ping(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("redis timeout")), 3000),
      ),
    ]);
    return { status: "pass", responseTime: Date.now() - start };
  } catch (error) {
    logger.error({ error }, "Redis health check failed");
    return { status: "fail", error: "redis_unavailable" };
  }
}

function checkMemory(): HealthCheck["checks"]["memory"] {
  const usage = process.memoryUsage();
  const totalMemory = usage.heapTotal;
  const usedMemory = usage.heapUsed;
  const percentage = (usedMemory / totalMemory) * 100;

  let status: "pass" | "warn" | "fail" = "pass";
  if (percentage > 90) {
    status = "fail";
  } else if (percentage > 75) {
    status = "warn";
  }

  return {
    status,
    used: usedMemory,
    total: totalMemory,
    percentage: Math.round(percentage * 100) / 100,
    rss: usage.rss, // Resident Set Size - total memory allocated
    external: usage.external, // Memory used by C++ objects bound to JS
  };
}

export async function GET() {
  try {
    const [database, redis, storage, migrations, memory] = await Promise.all([
      checkDatabase(),
      checkRedis(),
      checkStorage(),
      checkMigrations(),
      Promise.resolve(checkMemory()),
    ]);

    const checks = { database, redis, storage, migrations, memory };

    // Calculate overall status
    let overallStatus: HealthCheck["status"] = "healthy";
    if (
      database.status === "fail" ||
      redis.status === "fail" ||
      storage.status === "fail" ||
      migrations.status === "fail"
    ) {
      overallStatus = "unhealthy";
    } else if (memory.status === "warn") {
      overallStatus = "degraded";
    } else if (memory.status === "fail") {
      overallStatus = "unhealthy";
    }

    // Calculate uptime in seconds
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

    const health: HealthCheck = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: API_VERSION,
      uptime: uptimeSeconds,
      checks,
    };

    const statusCode = overallStatus === "healthy" ? 200 : 503;

    // Add cache control headers - don't cache health checks
    const response = NextResponse.json(health, { status: statusCode });
    response.headers.set(
      "Cache-Control",
      "no-cache, no-store, must-revalidate",
    );
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");

    return response;
  } catch (error) {
    logger.error({ error }, "Health check failed");
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        version: API_VERSION,
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}
