import { describe, expect, it, vi } from "vitest";
import { safeFetch, validateUrlForSsrf } from "@/lib/utils/ssrf-protection";

describe("hostile SSRF inputs", () => {
  it.each([
    "http://2130706433/",
    "http://0177.0.0.1/",
    "http://0x7f000001/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::1]/",
  ])("blocks alternate local address %s", (url) => {
    expect(validateUrlForSsrf(url).valid).toBe(false);
  });

  it("revalidates redirect targets before fetching them", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/admin" },
      }),
    );
    const result = await safeFetch("https://example.com");
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
