import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWebhookSignature,
  deliverSignedWebhook,
} from "@/lib/agents/webhooks";
import * as ssrfProtection from "@/lib/utils/ssrf-protection";

describe("Agent Webhooks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(ssrfProtection, "validateUrlForSsrfWithDns").mockResolvedValue({
      valid: true,
    });
  });

  it("creates deterministic webhook signatures", () => {
    const signature = createWebhookSignature({
      secret: "super-secret",
      timestamp: "1710000000000",
      deliveryId: "delivery-1",
      body: '{"hello":"world"}',
    });

    expect(signature).toMatch(/^[a-f0-9]{64}$/);
    expect(signature).toBe(
      "633f6b6a5c20fab14bb73dc16121820984a4938a5bf98adb09806a63bb1c90ad",
    );
  });

  it("delivers signed webhooks and strips reserved headers", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("accepted", { status: 202 }));

    const response = await deliverSignedWebhook({
      url: "https://example.com/hooks/memoria",
      secret: "super-secret",
      method: "POST",
      headers: {
        "x-custom-header": "custom",
        "x-memoria-signature": "should-be-ignored",
      },
      body: {
        ok: true,
      },
    });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({
      "content-type": "application/json",
      "x-custom-header": "custom",
    });
    expect(
      (init?.headers as Record<string, string>)["x-memoria-signature"],
    ).toMatch(/^sha256=/);
  });

  it("rejects invalid custom header names", async () => {
    await expect(
      deliverSignedWebhook({
        url: "https://example.com/hooks/memoria",
        secret: "super-secret",
        headers: {
          "bad header": "value",
        },
        body: {},
      }),
    ).rejects.toMatchObject({
      status: 400,
      detail: expect.stringContaining("Invalid webhook header name"),
    });
  });
});
