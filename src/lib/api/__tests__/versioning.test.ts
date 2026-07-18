/**
 * API Versioning Tests
 *
 * API versioning tests.
 *
 * Tests for the API versioning system
 */

import { describe, it, expect } from "vitest";
import {
  API_VERSION,
  API_VERSION_PREFIX,
  SUPPORTED_VERSIONS,
  isVersionSupported,
  isVersionDeprecated,
  extractVersionFromPath,
  getVersionHeaders,
  validateApiVersion,
} from "@/lib/api/versioning";

describe("API Versioning", () => {
  describe("Constants", () => {
    it("should have valid API version", () => {
      expect(API_VERSION).toBeTruthy();
      expect(API_VERSION).toMatch(/^\d+\.\d+\.\d+$/); // Semver format
    });

    it("should have valid version prefix", () => {
      expect(API_VERSION_PREFIX).toBeTruthy();
      expect(API_VERSION_PREFIX).toMatch(/^v\d+$/); // v1, v2, etc.
    });

    it("should have supported versions", () => {
      expect(SUPPORTED_VERSIONS).toBeInstanceOf(Array);
      expect(SUPPORTED_VERSIONS.length).toBeGreaterThan(0);
      expect(SUPPORTED_VERSIONS).toContain("v1");
    });
  });

  describe("isVersionSupported", () => {
    it("should return true for v1", () => {
      expect(isVersionSupported("v1")).toBe(true);
    });

    it("should return false for unsupported versions", () => {
      expect(isVersionSupported("v99")).toBe(false);
      expect(isVersionSupported("v0")).toBe(false);
      expect(isVersionSupported("invalid")).toBe(false);
    });
  });

  describe("isVersionDeprecated", () => {
    it("should return false for current versions", () => {
      expect(isVersionDeprecated("v1")).toBe(false);
    });

    it("should return false for non-existent versions", () => {
      expect(isVersionDeprecated("v99")).toBe(false);
    });
  });

  describe("extractVersionFromPath", () => {
    it("should extract version from valid API paths", () => {
      expect(extractVersionFromPath("/api/v1/canvases")).toBe("v1");
      expect(extractVersionFromPath("/api/v1/items")).toBe("v1");
      expect(extractVersionFromPath("/api/v2/auth/login")).toBe("v2");
    });

    it("should return null for paths without version", () => {
      expect(extractVersionFromPath("/api/health")).toBeNull();
      expect(extractVersionFromPath("/api/auth/login")).toBeNull();
      expect(extractVersionFromPath("/")).toBeNull();
      expect(extractVersionFromPath("/canvas/123")).toBeNull();
    });

    it("should handle edge cases", () => {
      expect(extractVersionFromPath("")).toBeNull();
      expect(extractVersionFromPath("/v1/canvases")).toBeNull(); // Missing /api
      expect(extractVersionFromPath("/api/v1")).toBeNull(); // No path after version
    });
  });

  describe("getVersionHeaders", () => {
    it("should return version headers for valid API paths", () => {
      const headers = getVersionHeaders("/api/v1/canvases");

      expect(headers).toHaveProperty("X-API-Version");
      expect(headers["X-API-Version"]).toBe(API_VERSION);
      expect(headers).toHaveProperty("X-API-Version-Prefix");
      expect(headers["X-API-Version-Prefix"]).toBe(API_VERSION_PREFIX);
      expect(headers).toHaveProperty("X-API-Deprecated");
      expect(headers["X-API-Deprecated"]).toBe("false");
    });

    it("should not include deprecation headers for current versions", () => {
      const headers = getVersionHeaders("/api/v1/items");

      expect(headers["X-API-Deprecated"]).toBe("false");
      expect(headers).not.toHaveProperty("X-API-Sunset");
      expect(headers).not.toHaveProperty("Link");
    });

    it("should handle non-versioned paths gracefully", () => {
      const headers = getVersionHeaders("/api/health");

      expect(headers).toHaveProperty("X-API-Version");
      expect(headers["X-API-Deprecated"]).toBe("false");
    });
  });

  describe("validateApiVersion", () => {
    it("should return null for valid versions", () => {
      expect(validateApiVersion("/api/v1/canvases")).toBeNull();
      expect(validateApiVersion("/api/v1/items")).toBeNull();
    });

    it("should return error for unsupported versions", () => {
      const error = validateApiVersion("/api/v99/canvases");
      expect(error).toBeTruthy();
      expect(error).toContain("not supported");
      expect(error).toContain("v99");
    });

    it("should return null for non-versioned paths", () => {
      expect(validateApiVersion("/api/health")).toBeNull();
      expect(validateApiVersion("/api/auth/login")).toBeNull();
      expect(validateApiVersion("/")).toBeNull();
    });

    it("should handle edge cases", () => {
      expect(validateApiVersion("")).toBeNull();
      expect(validateApiVersion("/api")).toBeNull();
    });
  });

  describe("Integration", () => {
    it("should work end-to-end for valid API request", () => {
      const path = "/api/v1/canvases";

      // Extract version
      const version = extractVersionFromPath(path);
      expect(version).toBe("v1");

      // Validate version
      const validationError = validateApiVersion(path);
      expect(validationError).toBeNull();

      // Check if supported
      expect(isVersionSupported(version!)).toBe(true);

      // Get headers
      const headers = getVersionHeaders(path);
      expect(headers["X-API-Deprecated"]).toBe("false");
    });

    it("should work end-to-end for unsupported version", () => {
      const path = "/api/v99/canvases";

      // Extract version
      const version = extractVersionFromPath(path);
      expect(version).toBe("v99");

      // Validate version (should fail)
      const validationError = validateApiVersion(path);
      expect(validationError).toBeTruthy();

      // Check if supported (should be false)
      expect(isVersionSupported(version!)).toBe(false);
    });
  });
});
