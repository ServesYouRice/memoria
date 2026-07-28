import { ItemType } from "@prisma/client";
import { ApiError } from "@/lib/errors";

export function requirePollsEnabled(type: string): void {
  if (type !== ItemType.POLL) return;
  throw new ApiError(
    404,
    "https://memoria.local/errors/feature-disabled",
    "Feature Disabled",
    "Polls are disabled until voting is server-authoritative.",
  );
}
