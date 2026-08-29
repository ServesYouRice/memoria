import { describe, expect, it } from "vitest";
import { calculateViewportWindow } from "@/features/canvas/viewport-budget";
import { RESOURCE_BUDGETS } from "@/lib/policy/resource-budgets";
import {
  ConnectionAdmissionCounters,
  type ConnectionAdmissionLimits,
} from "@/lib/collaboration/transport-policy";

function geometryItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `clitem${String(index).padStart(19, "0")}`,
    type: "NOTE",
    positionX: index * 320,
    positionY: (index % 25) * 240,
    width: 300,
    height: 200,
    zIndex: index,
    version: 1,
  }));
}

describe("advertised launch resource budgets", () => {
  it("keeps representative geometry payloads under the 512 KiB index budget", () => {
    for (const count of RESOURCE_BUDGETS.canvas.regressionItemCounts) {
      const bytes = Buffer.byteLength(
        JSON.stringify({ items: geometryItems(count) }),
        "utf8",
      );
      expect(bytes, `${count}-item geometry payload`).toBeLessThanOrEqual(
        RESOURCE_BUDGETS.canvas.geometryIndexBytes,
      );
    }
  });

  it("keeps small pointer movement in one padded viewport tile", () => {
    const first = calculateViewportWindow({
      zoom: 1,
      position: { x: 0, y: 0 },
      size: { width: 1_280, height: 720 },
    });
    const next = calculateViewportWindow({
      zoom: 1,
      position: { x: 8, y: 6 },
      size: { width: 1_280, height: 720 },
    });
    expect(next).toEqual(first);
    expect(first.limit).toBe(RESOURCE_BUDGETS.canvas.viewportPageItems);
    expect(first.maxX - first.minX).toBeGreaterThan(1_280);
  });

  it("profiles the 50-client collaboration regression without unbounded maps", () => {
    const counters = new ConnectionAdmissionCounters();
    const limits: ConnectionAdmissionLimits = {
      global: RESOURCE_BUDGETS.collaboration.regressionClients,
      perPrincipal: 2,
      perClient: 1,
    };
    for (let index = 0; index < limits.global; index += 1) {
      expect(
        counters.tryAdmit(`user-${index}`, `client-${index}`, limits),
      ).toEqual({ admitted: true });
    }
    expect(counters.totalConnections).toBe(
      RESOURCE_BUDGETS.collaboration.regressionClients,
    );
    expect(counters.tryAdmit("overflow", "overflow", limits)).toEqual({
      admitted: false,
      reason: "global",
    });
  });

  it("publishes explicit timing, memory, export, and capacity ceilings", () => {
    expect(RESOURCE_BUDGETS.canvas.maxPanFrameMs).toBe(16.67);
    expect(RESOURCE_BUDGETS.canvas.maxEventLoopLagMs).toBe(50);
    expect(RESOURCE_BUDGETS.canvas.maxHeapGrowthBytes).toBe(64 * 1024 * 1024);
    expect(RESOURCE_BUDGETS.accountExport.maxArchiveBytes).toBeLessThan(
      RESOURCE_BUDGETS.accountExport.maxUncompressedBytes,
    );
    expect(RESOURCE_BUDGETS.canvas.maxItems).toBe(2_000);
  });
});
