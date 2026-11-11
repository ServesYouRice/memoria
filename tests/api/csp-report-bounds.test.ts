import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

import { logger } from "@/lib/logger";
import { POST } from "@/app/api/csp-report/route";

const URL = "http://localhost/api/csp-report";

function countingStream(chunkBytes: number, chunks: number) {
  const state = { pulls: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulls += 1;
      if (state.pulls > chunks) return controller.close();
      controller.enqueue(new Uint8Array(chunkBytes).fill(0x20));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

describe("CSP report body bound (TASK-027)", () => {
  it("rejects an oversized Content-Length before reading the body", async () => {
    const { stream, state } = countingStream(1024, 64);
    const request = new NextRequest(URL, {
      method: "POST",
      headers: { "content-length": String(64 * 1024) },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(state.pulls).toBeLessThanOrEqual(1);
  });

  it("stops reading a streamed body once it passes the cap", async () => {
    const { stream, state } = countingStream(1024, 1024);
    const request = new NextRequest(URL, {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(state.pulls).toBeLessThan(40);
    expect(state.cancelled).toBe(true);
  });

  it("still logs a valid report and answers 204", async () => {
    const response = await POST(
      new NextRequest(URL, {
        method: "POST",
        body: JSON.stringify({
          "csp-report": {
            "document-uri": "https://app.example/",
            "violated-directive": "script-src",
          },
        }),
      }),
    );
    expect(response.status).toBe(204);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ violatedDirective: "script-src" }),
      "CSP violation detected",
    );
  });
});
