import { ApiError } from "@/lib/errors";
import {
  isLaunchCapabilityEnabled,
  type LaunchCapability,
} from "@/lib/product-surfaces";

type TemplateCapability = Extract<
  LaunchCapability,
  "templates" | "canvasDuplication"
>;

/** Throws 404 while the launch switch for templates or duplication is off. */
export function requireTemplatesEnabled(
  capability: TemplateCapability = "templates",
): void {
  if (isLaunchCapabilityEnabled(capability)) return;
  throw new ApiError(
    404,
    "https://memoria.local/errors/feature-disabled",
    "Feature Disabled",
    capability === "templates"
      ? "Templates are switched off on this server."
      : "Duplicating canvases is switched off on this server.",
  );
}
