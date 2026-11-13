import { ItemType } from "@/generated/prisma/client";
import { ApiError } from "@/lib/errors";
import { isLaunchCapabilityEnabled } from "@/lib/product-surfaces";

/**
 * Whether poll items may be created and read. Votes are counted on the
 * server since IMP-104; the switch stays as a kill switch.
 */
export function arePollsEnabled(): boolean {
  return isLaunchCapabilityEnabled("polls");
}

export function requirePollsEnabled(type: string): void {
  if (type !== ItemType.POLL || arePollsEnabled()) return;
  throw new ApiError(
    404,
    "https://memoria.local/errors/feature-disabled",
    "Feature Disabled",
    "Polls are switched off.",
  );
}
