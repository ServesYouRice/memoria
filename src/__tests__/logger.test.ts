import { describe, it, expect } from "vitest";
import {
  generateRequestId,
  createRequestLogger,
  createLogger,
} from "../lib/logger";

describe("Logger", () => {
  describe("generateRequestId", () => {
    it("should generate a request ID", () => {
      const id = generateRequestId();
      expect(id).toBeTruthy();
      expect(typeof id).toBe("string");
    });

    it("should generate unique IDs", () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();
      expect(id1).not.toBe(id2);
    });
  });

  describe("createRequestLogger", () => {
    it("should create logger with request ID", () => {
      const logger = createRequestLogger("test-123");
      expect(logger).toBeTruthy();
      expect(logger.bindings()).toHaveProperty("requestId", "test-123");
    });

    it("should create logger with user ID", () => {
      const logger = createRequestLogger("test-123", "user-456");
      expect(logger.bindings()).toHaveProperty("userId", "user-456");
    });

    it("should auto-generate request ID if not provided", () => {
      const logger = createRequestLogger();
      expect(logger.bindings()).toHaveProperty("requestId");
      expect(logger.bindings()["requestId"]).toBeTruthy();
    });
  });

  describe("createLogger", () => {
    it("should create logger with module name", () => {
      const logger = createLogger("test-module");
      expect(logger).toBeTruthy();
      expect(logger.bindings()).toHaveProperty("module", "test-module");
    });
  });
});
