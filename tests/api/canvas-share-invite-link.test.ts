/**
 * IMP-145 (handbook ME-07, RUN-ME-3): without a mail provider the canvas
 * owner gets the invitation link to send themselves; with one, the link is
 * never returned and delivery goes through the outbox.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  canvasFindUnique: vi.fn(),
  invitationCreate: vi.fn(),
  enqueueOutboxJob: vi.fn(),
  provider: { value: "console" },
}));

vi.mock("@/lib/api/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/env", () => ({
  env: { AUTH_URL: "https://staging.memoria.example" },
}));
vi.mock("@/lib/email", () => ({
  getEmailConfig: () => ({ provider: mocks.provider.value }),
}));
vi.mock("@/lib/policy/capacity", () => ({
  assertCanvasShareCapacity: vi.fn(),
}));
vi.mock("@/lib/agents/crypto", () => ({
  encryptSecret: (value: string) => `enc:${value}`,
  fingerprintSecret: (value: string) => `hash:${value}`,
}));
vi.mock("@/lib/outbox/enqueue", () => ({
  enqueueOutboxJob: mocks.enqueueOutboxJob,
}));
vi.mock("@/lib/db", () => {
  const tx = {
    canvas: { findUnique: mocks.canvasFindUnique },
    canvasShareInvitation: {
      updateMany: vi.fn(),
      create: mocks.invitationCreate,
    },
    user: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) =>
        run(tx),
      ),
    },
  };
});

import { POST } from "@/app/api/v1/canvases/[canvasId]/share/route";

const params = { params: Promise.resolve({ canvasId: "c1" }) };
const request = () =>
  new NextRequest("http://localhost/api/v1/canvases/c1/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "Friend@Example.com", role: "VIEW" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.provider.value = "console";
  mocks.requireAuth.mockResolvedValue({ userId: "u1", email: "owner@x.dev" });
  mocks.canvasFindUnique.mockResolvedValue({ userId: "u1" });
  mocks.invitationCreate.mockResolvedValue({ id: "inv1" });
});

describe("POST /api/v1/canvases/:canvasId/share invitation link", () => {
  it("returns a link to copy when no mail provider is set up", async () => {
    const response = await POST(request(), params);
    expect(response.status).toBe(202);
    const body = (await response.json()) as { invitationUrl?: string };
    expect(body.invitationUrl).toMatch(
      /^https:\/\/staging\.memoria\.example\/share-invitations\/[A-Za-z0-9_-]{43}$/,
    );
    const token = body.invitationUrl!.split("/").pop();
    expect(mocks.invitationCreate.mock.calls[0]![0].data.tokenHash).toBe(
      `hash:${token}`,
    );
  });

  it("never returns the link when mail is set up", async () => {
    mocks.provider.value = "smtp";
    const response = await POST(request(), params);
    expect(response.status).toBe(202);
    const body = (await response.json()) as { invitationUrl?: string };
    expect(body.invitationUrl).toBeUndefined();
    expect(mocks.enqueueOutboxJob).toHaveBeenCalledOnce();
  });

  it("gives no link to someone who does not own the canvas", async () => {
    mocks.canvasFindUnique.mockResolvedValue({ userId: "someone-else" });
    const response = await POST(request(), params);
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain(
      "share-invitations",
    );
  });
});
