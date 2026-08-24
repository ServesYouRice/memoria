import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireAuth: vi.fn(),
  canvasCount: vi.fn(),
  canvasFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/api/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    canvas: {
      count: mocks.canvasCount,
      findMany: mocks.canvasFindMany,
    },
  },
}));

import { GET as templatesGet } from "@/app/api/v1/templates/route";
import { POST as duplicatePost } from "@/app/api/v1/canvases/[canvasId]/duplicate/route";

describe("launch template gates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an explicit disabled problem before template reads", async () => {
    const response = await templatesGet(
      new Request("https://memoria.example/api/v1/templates") as never,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      type: "https://memoria.local/errors/feature-disabled",
      title: "Feature Disabled",
    });
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.canvasFindMany).not.toHaveBeenCalled();
  });

  it("returns the same disabled problem before canvas duplication auth", async () => {
    const response = await duplicatePost(
      new Request("https://memoria.example/api/v1/canvases/source/duplicate", {
        method: "POST",
      }) as never,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      type: "https://memoria.local/errors/feature-disabled",
    });
    expect(mocks.requireAuth).not.toHaveBeenCalled();
  });
});
