import { type NextRequest } from "next/server";
import { registerClient } from "@/lib/oauth/service";
import { oauthErrorResponse, oauthJsonResponse } from "@/lib/oauth/http";

/** RFC 7591 dynamic client registration; clients start without credentials. */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as unknown;
    return oauthJsonResponse(await registerClient(body), 201);
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
