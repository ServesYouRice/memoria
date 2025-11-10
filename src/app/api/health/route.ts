import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { PrismaClient } from '@prisma/client';

const logger = createLogger('health');
const prisma = new PrismaClient();

interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
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
  };
}

export async function GET() {
  try {
    const [database, memory] = await Promise.all([checkDatabase(), Promise.resolve(checkMemory())]);

    const checks = { database, memory };

    let overallStatus: HealthCheck['status'] = 'healthy';
    if (database.status === 'fail') {
      overallStatus = 'unhealthy';
    } else if (memory.status === 'warn') {
      overallStatus = 'degraded';
    } else if (memory.status === 'fail') {
      overallStatus = 'unhealthy';
    }

    const health: HealthCheck = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks,
    };

    const statusCode = overallStatus === 'healthy' ? 200 : 503;

    return NextResponse.json(health, { status: statusCode });
  } catch (error) {
    logger.error({ error }, 'Health check failed');
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}
