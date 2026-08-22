import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWebhookSignature,
  deliverSignedWebhook,
} from "@/lib/agents/webhooks";
import * as ssrfProtection from "@/lib/utils/ssrf-protection";

describe("Agent Webhooks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // IMP-043 made the validator pin a resolved address, and the sender now
    // rejects a result missing pinnedIp or targetUrl. A bare { valid: true }
    // fails that guard before any delivery is attempted.
    vi.spyOn(ssrfProtection, "validateUrlForSsrfWithDns").mockResolvedValue({
      valid: true,
      pinnedIp: "93.184.216.34",
      targetUrl: new URL("https://example.com/hooks/memoria"),
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
    // The sender goes through pinnedHttpRequest, not fetch, so mocking
    // globalThis.fetch intercepts nothing and the delivery reaches the network.
    const requestMock = vi
      .spyOn(ssrfProtection, "pinnedHttpRequest")
      .mockResolvedValue({
        status: 202,
        headers: {},
        body: "accepted",
        ok: true,
      });

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
    expect(requestMock).toHaveBeenCalledTimes(1);

    const [, , options] = requestMock.mock.calls[0];
    expect(options?.headers).toMatchObject({
      "content-type": "application/json",
      "x-custom-header": "custom",
    });
    expect(
      (options?.headers as Record<string, string>)["x-memoria-signature"],
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
