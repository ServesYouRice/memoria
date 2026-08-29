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

import {
  GET as templatesGet,
  POST as templatesPost,
} from "@/app/api/v1/templates/route";
import { POST as duplicatePost } from "@/app/api/v1/canvases/[canvasId]/duplicate/route";

describe("launch template gates (IMP-062)", () => {
  beforeEach(() => vi.clearAllMocks());

  const templateHandlers = [
    {
      method: "GET",
      handler: () =>
        templatesGet(
          new Request("https://memoria.example/api/v1/templates") as never,
        ),
    },
    {
      method: "POST",
      handler: () =>
        templatesPost(
          new Request("https://memoria.example/api/v1/templates", {
            method: "POST",
          }) as never,
        ),
    },
  ];

  it.each(templateHandlers)(
    "authenticates, then returns an explicit disabled problem on $method",
    async ({ handler }) => {
      const response = await handler();
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        type: "https://memoria.local/errors/feature-disabled",
        title: "Feature Disabled",
      });
      expect(mocks.auth).not.toHaveBeenCalled();
      expect(mocks.requireAuth).toHaveBeenCalledTimes(1);
      expect(mocks.canvasFindMany).not.toHaveBeenCalled();
      expect(mocks.canvasCount).not.toHaveBeenCalled();
    },
  );

  it("authenticates before returning the canvas duplication gate", async () => {
    const response = await duplicatePost(
      new Request("https://memoria.example/api/v1/canvases/source/duplicate", {
        method: "POST",
      }) as never,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      type: "https://memoria.local/errors/feature-disabled",
    });
    expect(mocks.requireAuth).toHaveBeenCalledTimes(1);
  });
});
