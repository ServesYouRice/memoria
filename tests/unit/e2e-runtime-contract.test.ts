import { afterEach, describe, expect, it, vi } from "vitest";
import { imageContentSchema } from "@/lib/validation/canvas-item";
import { SendGridEmailProvider } from "@/lib/email/providers/sendgrid";

afterEach(() => vi.unstubAllGlobals());

describe("production E2E runtime contracts", () => {
  it("accepts only the private upload relative URL shape", () => {
    expect(
      imageContentSchema.parse({
        url: "/api/v1/uploads/clupload123456789012345678",
        filename: "pixel.png",
      }),
    ).toMatchObject({ url: "/api/v1/uploads/clupload123456789012345678" });

    expect(
      imageContentSchema.safeParse({
        url: "/untrusted/image.png",
        filename: "pixel.png",
      }).success,
    ).toBe(false);
  });

  it("delivers through the explicitly configured E2E SendGrid endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new SendGridEmailProvider({
      apiKey: "capture-key",
      apiUrl: "http://email-capture:8025/v3/mail/send",
    });

    await provider.send({
      to: { email: "recipient@example.com" },
      from: { email: "sender@example.com" },
      subject: "Captured",
      text: "Email body",
      deliveryId: "job-1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://email-capture:8025/v3/mail/send",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer capture-key",
        }),
      }),
    );
  });
});
