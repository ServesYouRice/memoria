/**
 * Browser-side Better Auth client (IMP-041).
 *
 * Sessions live in httpOnly cookies; this client only calls the same-origin
 * `/api/auth/*` endpoints that `src/lib/auth/server.ts` allows.
 */

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { clearOfflineCache } from "@/lib/collaboration/sync/offline-store";

export const authClient = createAuthClient({
  plugins: [twoFactorClient(), passkeyClient()],
});

export const { useSession } = authClient;

/**
 * Sign out of this browser, then do a full navigation to `destination`.
 * `navigateOnError` is for callers whose server-side sessions are already
 * gone (account deletion), where a failed cookie clear must not strand them.
 */
export async function signOutAndRedirect(
  destination = "/",
  options: { navigateOnError?: boolean } = {},
): Promise<void> {
  const { error } = await authClient.signOut().catch((cause: unknown) => ({
    error: { message: cause instanceof Error ? cause.message : undefined },
  }));
  if (error && !options.navigateOnError) {
    throw new Error(error.message || "Sign out failed");
  }
  // IMP-045: the canvases kept on this device for offline use, including
  // edits not synced yet, leave with the user.
  await clearOfflineCache().catch(() => {});
  window.location.assign(destination);
}
