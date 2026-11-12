import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  enabled: vi.fn(() => true),
}));

vi.mock("@/lib/api/auth", () => ({
  requireAuth: mocks.requireAuth,
  requireCanvasAccess: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/product-surfaces", () => ({
  isLaunchCapabilityEnabled: mocks.enabled,
}));

import { GET as templatesGet } from "@/app/api/v1/templates/route";
import { POST as usePost } from "@/app/api/v1/templates/[templateId]/use/route";
import { POST as duplicatePost } from "@/app/api/v1/canvases/[canvasId]/duplicate/route";
import { UnauthorizedError } from "@/lib/errors";

describe("template and duplication switches (IMP-098)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "u1", email: "u@x.com" });
    mocks.enabled.mockReturnValue(true);
  });

  it("lists 10 to 20 built-in templates, each with a preview", async () => {
    const response = await templatesGet(
      new Request("https://memoria.example/api/v1/templates") as never,
      {} as never,
    );
    expect(response.status).toBe(200);
    const { templates } = await response.json();
    expect(templates.length).toBeGreaterThanOrEqual(10);
    expect(templates.length).toBeLessThanOrEqual(20);
    for (const template of templates) {
      expect(template.name).toBeTruthy();
      expect(template.preview.length).toBeGreaterThan(0);
    }
  });

  it("asks for a session first", async () => {
    mocks.requireAuth.mockRejectedValue(new UnauthorizedError());
    const response = await templatesGet(
      new Request("https://memoria.example/api/v1/templates") as never,
      {} as never,
    );
    expect(response.status).toBe(401);
  });

  it("answers 404 while a switch is off", async () => {
    mocks.enabled.mockReturnValue(false);
    const use = await usePost(
      new Request("https://memoria.example/api/v1/templates/todo-list/use", {
        method: "POST",
      }) as never,
      { params: Promise.resolve({ templateId: "todo-list" }) },
    );
    expect(use.status).toBe(404);
    const duplicate = await duplicatePost(
      new Request("https://memoria.example/api/v1/canvases/c1/duplicate", {
        method: "POST",
      }) as never,
      { params: Promise.resolve({ canvasId: "c1" }) },
    );
    expect(duplicate.status).toBe(404);
    expect(await duplicate.json()).toMatchObject({
      type: "https://memoria.local/errors/feature-disabled",
    });
  });
});
