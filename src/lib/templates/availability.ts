import { ApiError } from "@/lib/errors";
import {
  isLaunchCapabilityEnabled,
  type LaunchCapability,
} from "@/lib/product-surfaces";

type TemplateCapability = Extract<
  LaunchCapability,
  "templates" | "canvasDuplication"
>;

export function requireTemplatesEnabled(
  capability: TemplateCapability = "templates",
): never {
  if (isLaunchCapabilityEnabled(capability)) {
    throw new ApiError(
      500,
      "https://memoria.local/errors/feature-route-unavailable",
      "Feature Route Unavailable",
      "The capability was enabled without installing its authenticated route implementation.",
    );
  }
  throw new ApiError(
    404,
    "https://memoria.local/errors/feature-disabled",
    "Feature Disabled",
    "Templates and canvas duplication are disabled for this release.",
  );
}
