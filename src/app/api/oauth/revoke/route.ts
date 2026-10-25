import { type NextRequest, NextResponse } from "next/server";
import { authenticateClient, revokeToken } from "@/lib/oauth/service";
import {
  oauthErrorResponse,
  readClientCredentials,
  readOAuthForm,
} from "@/lib/oauth/http";

/** RFC 7009: answers 200 whether or not the token was known. */
export async function POST(request: NextRequest) {
  try {
    const form = await readOAuthForm(request);
    const credentials = readClientCredentials(request, form);
    const client = await authenticateClient(
      credentials.clientId,
      credentials.clientSecret,
    );

    if (form.token) {
      await revokeToken({ clientId: client.clientId, token: form.token });
    }

    return new NextResponse(null, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
