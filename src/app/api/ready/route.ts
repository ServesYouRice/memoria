import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getRedisClient } from "@/lib/cache/redis-client";
import { checkPrivateUploadStorage } from "@/lib/uploads/private-storage";
import { hasInternalOperationsAccess } from "@/lib/operations/internal-auth";

export async function GET(request: Request) {
  if (!hasInternalOperationsAccess(request)) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  const redis = getRedisClient();
  const checks = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
    redis ? redis.ping() : Promise.reject(new Error("redis unavailable")),
    checkPrivateUploadStorage(),
    prisma.$queryRaw`
      SELECT 1 FROM "_prisma_migrations"
      WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL
      LIMIT 1
    `.then((rows: unknown) => {
      if (Array.isArray(rows) && rows.length > 0)
        throw new Error("migration incomplete");
    }),
  ]);
  const ready = checks.every((check) => check.status === "fulfilled");
  return NextResponse.json(
    { status: ready ? "ready" : "unavailable" },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
