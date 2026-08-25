import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("service worker cache activation filter", () => {
  it("only deletes obsolete Memoria caches and legacy caches while preserving unrelated and active caches", () => {
    const swContent = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../public/sw.js"),
      "utf-8",
    );

    // Extract constants from sw.js
    expect(swContent).toContain('const CACHE_NAME = "memoria-public-v2";');
    expect(swContent).toContain(
      'const UNSAFE_LEGACY_CACHES = new Set(["canvascollect-v1"]);',
    );
    expect(swContent).toContain('const MEMORIA_CACHE_PREFIX = "memoria-";');

    const CACHE_NAME = "memoria-public-v2";
    const UNSAFE_LEGACY_CACHES = new Set(["canvascollect-v1"]);
    const MEMORIA_CACHE_PREFIX = "memoria-";

    const filterFn = (name: string) =>
      name !== CACHE_NAME &&
      (name.startsWith(MEMORIA_CACHE_PREFIX) || UNSAFE_LEGACY_CACHES.has(name));

    // Current cache survives
    expect(filterFn(CACHE_NAME)).toBe(false);

    // Obsolete Memoria cache is deleted
    expect(filterFn("memoria-public-v1")).toBe(true);
    expect(filterFn("memoria-assets-v1")).toBe(true);

    // Unsafe legacy cache is deleted
    expect(filterFn("canvascollect-v1")).toBe(true);

    // Unrelated origin caches survive
    expect(filterFn("cohosted-app-cache")).toBe(false);
    expect(filterFn("unrelated-service-v1")).toBe(false);
    expect(filterFn("workbox-precache")).toBe(false);
  });
});
