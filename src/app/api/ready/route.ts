import { NextResponse } from "next/server";
import { hasInternalOperationsAccess } from "@/lib/operations/internal-auth";
import { evaluateReadiness } from "@/lib/operations/readiness";

export async function GET(request: Request) {
  if (!hasInternalOperationsAccess(request)) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  const snapshot = await evaluateReadiness();
  const ready = snapshot.status !== "unavailable";
  return NextResponse.json(snapshot, {
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
