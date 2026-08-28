import { ItemType } from "@/generated/prisma/client";
import { ApiError } from "@/lib/errors";
import { isLaunchCapabilityEnabled } from "@/lib/product-surfaces";

export function requirePollsEnabled(type: string): void {
  if (type !== ItemType.POLL || isLaunchCapabilityEnabled("polls")) return;
  throw new ApiError(
    404,
    "https://memoria.local/errors/feature-disabled",
    "Feature Disabled",
    "Polls are disabled until voting is server-authoritative.",
  );
}
