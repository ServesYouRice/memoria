import { z } from "zod";
import type { ReadinessStatus } from "./readiness";

export const publicStatusSchema = z
  .object({
    status: z.enum(["operational", "degraded", "outage"]),
    checkedAt: z.string().datetime(),
  })
  .strict();

export type PublicStatus = z.infer<typeof publicStatusSchema>;

export function toPublicStatus(
  status: ReadinessStatus,
): PublicStatus["status"] {
  if (status === "ready") return "operational";
  if (status === "degraded") return "degraded";
  return "outage";
}
