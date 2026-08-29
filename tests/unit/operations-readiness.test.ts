import { describe, expect, it } from "vitest";
import {
  evaluateReadiness,
  type ReadinessCheckDefinition,
} from "@/lib/operations/readiness";
import {
  publicStatusSchema,
  toPublicStatus,
} from "@/lib/operations/public-status";

function check(
  name: ReadinessCheckDefinition["name"],
  effect: ReadinessCheckDefinition["effect"],
  run: () => Promise<unknown>,
): ReadinessCheckDefinition {
  return { name, effect, run };
}

describe("operations readiness policy", () => {
  it("removes traffic when a required dependency fails", async () => {
    const snapshot = await evaluateReadiness([
      check("database", "traffic", async () => {
        throw new Error("down");
      }),
      check("upload-storage", "feature", async () => undefined),
    ]);
    expect(snapshot.status).toBe("unavailable");
  });

  it("keeps traffic while reporting a feature degradation", async () => {
    const snapshot = await evaluateReadiness([
      check("database", "traffic", async () => undefined),
      check("upload-storage", "feature", async () => {
        throw new Error("down");
      }),
    ]);
    expect(snapshot.status).toBe("degraded");
    expect(toPublicStatus(snapshot.status)).toBe("degraded");
  });

  it("bounds dependency checks and exposes no detail publicly", async () => {
    const snapshot = await evaluateReadiness(
      [check("redis", "traffic", () => new Promise(() => undefined))],
      5,
    );
    const publicPayload = {
      status: toPublicStatus(snapshot.status),
      checkedAt: snapshot.checkedAt,
    };
    expect(snapshot.status).toBe("unavailable");
    expect(publicStatusSchema.parse(publicPayload)).toEqual(publicPayload);
    expect(publicPayload).not.toHaveProperty("checks");
  });
});
