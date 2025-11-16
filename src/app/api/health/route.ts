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

import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { prisma } from '@/lib/db';
import { API_VERSION } from '@/lib/api/versioning';

const logger = createLogger('health');

// Track when the application started
const startTime = Date.now();

interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database: {
      status: 'pass' | 'fail';
      responseTime?: number;
      error?: string;
    };
    memory: {
      status: 'pass' | 'warn' | 'fail';
      used: number;
      total: number;
      percentage: number;
      rss: number;
      external: number;
    };
  };
}

async function checkDatabase(): Promise<HealthCheck['checks']['database']> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const responseTime = Date.now() - start;
    return { status: 'pass', responseTime };
  } catch (error) {
    logger.error({ error }, 'Database health check failed');
    return {
      status: 'fail',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function checkMemory(): HealthCheck['checks']['memory'] {
  const usage = process.memoryUsage();
  const totalMemory = usage.heapTotal;
  const usedMemory = usage.heapUsed;
  const percentage = (usedMemory / totalMemory) * 100;

  let status: 'pass' | 'warn' | 'fail' = 'pass';
  if (percentage > 90) {
    status = 'fail';
  } else if (percentage > 75) {
    status = 'warn';
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
    const [database, memory] = await Promise.all([
      checkDatabase(),
      Promise.resolve(checkMemory()),
    ]);

    const checks = { database, memory };

    // Calculate overall status
    let overallStatus: HealthCheck['status'] = 'healthy';
    if (database.status === 'fail') {
      overallStatus = 'unhealthy';
    } else if (memory.status === 'warn') {
      overallStatus = 'degraded';
    } else if (memory.status === 'fail') {
      overallStatus = 'unhealthy';
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

    const statusCode = overallStatus === 'healthy' ? 200 : 503;

    // Add cache control headers - don't cache health checks
    const response = NextResponse.json(health, { status: statusCode });
    response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');

    return response;
  } catch (error) {
    logger.error({ error }, 'Health check failed');
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        version: API_VERSION,
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}
