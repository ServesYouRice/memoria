import { NextResponse } from "next/server";
import { evaluateReadiness } from "@/lib/operations/readiness";
import { toPublicStatus } from "@/lib/operations/public-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await evaluateReadiness();
  return NextResponse.json(
    {
      status: toPublicStatus(snapshot.status),
      checkedAt: snapshot.checkedAt,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
