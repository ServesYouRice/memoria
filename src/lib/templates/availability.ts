import { ApiError } from "@/lib/errors";

export function requireTemplatesEnabled(): never {
  throw new ApiError(
    404,
    "https://memoria.local/errors/feature-disabled",
    "Feature Disabled",
    "Templates and canvas duplication are disabled for this release.",
  );
}
