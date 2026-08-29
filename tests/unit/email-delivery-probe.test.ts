import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeliveryProbeEmailHandler } from "@/lib/email/outbox-handler";

const prisma = vi.hoisted(() => ({
  outboxJob: {
    create: vi.fn(),
    findFirst: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma }));

let GET: (request: Request) => Promise<Response>;
let POST: (request: Request) => Promise<Response>;

const operationsToken = "p".repeat(32);
const jobId = "cldelivery12345678901234567";

beforeAll(async () => {
  vi.resetModules();
  vi.stubEnv("INTERNAL_OPERATIONS_TOKEN", operationsToken);
  vi.stubEnv("EMAIL_SENDER_VERIFIED", "true");
  vi.stubEnv("EMAIL_DELIVERY_PROBE_TO", "operator@example.com");
  ({ GET, POST } = await import("@/app/api/operations/email/probe/route"));
});

beforeEach(() => {
  vi.clearAllMocks();
});

function request(method: "GET" | "POST", query = "") {
  return new Request(`http://localhost/api/operations/email/probe${query}`, {
    method,
    headers: { authorization: `Bearer ${operationsToken}` },
  });
}

describe("controlled email delivery probe", () => {
  it("uses the stable outbox delivery id at the provider boundary", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const signal = new AbortController().signal;

    await createDeliveryProbeEmailHandler(send)(
      {
        id: jobId,
        type: "email.delivery-probe",
        payload: { to: "operator@example.com" },
      } as never,
      { signal, deliveryId: jobId, deadlineAt: new Date() },
    );

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: { email: "operator@example.com" },
        deliveryId: jobId,
        signal,
      }),
    );
  });

  it("queues a probe only through the authenticated operations surface", async () => {
    prisma.outboxJob.create.mockResolvedValue({ id: jobId, status: "PENDING" });

    const hidden = await POST(
      new Request("http://localhost/api/operations/email/probe", {
        method: "POST",
      }),
    );
    const response = await POST(request("POST"));

    expect(hidden.status).toBe(404);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      jobId,
      status: "PENDING",
    });
    expect(prisma.outboxJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "email.delivery-probe",
        payload: { to: "operator@example.com" },
        maxAttempts: 3,
      }),
    });
  });

  it("reports only the requested delivery-probe job", async () => {
    prisma.outboxJob.findFirst.mockResolvedValue({
      id: jobId,
      status: "COMPLETED",
      attempts: 1,
      maxAttempts: 3,
      lastError: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await GET(request("GET", `?jobId=${jobId}`));

    expect(response.status).toBe(200);
    expect(prisma.outboxJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: jobId, type: "email.delivery-probe" },
      }),
    );
  });
});
