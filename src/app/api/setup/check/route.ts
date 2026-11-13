import { NextResponse } from "next/server";
import { isBootstrapAvailable } from "@/lib/bootstrap";
import { runSetupChecks } from "@/lib/operations/setup-check";

export const dynamic = "force-dynamic";

/**
 * The first-run page's set-up check (IMP-100). It answers only until the
 * first account exists (afterwards operators use `pnpm doctor` and the
 * token-protected `/api/ready`), and it says only pass/fail plus the fix:
 * no host names, addresses or error text.
 */
export async function GET() {
  let checks = await runSetupChecks();
  const database = checks.find((check) => check.name === "database");
  if (database?.ok) {
    const available = await isBootstrapAvailable().catch(() => false);
    if (!available)
      return NextResponse.json({ status: "not_found" }, { status: 404 });
  } else {
    // Without the database nobody can tell whether set-up is finished, so
    // say only what is plainly broken for every visitor anyway.
    checks = checks.filter((check) => check.name === "database");
  }
  return NextResponse.json(
    { ok: checks.every((check) => check.ok), checks },
    { headers: { "Cache-Control": "no-store" } },
  );
}
