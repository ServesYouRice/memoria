/**
 * API Auth Helpers Tests
 * Tests for /lib/api/auth.ts helpers
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  requireAuth,
  requireCanvasOwnership,
  requireItemOwnership,
} from "@/lib/api/auth";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";

// Mock dependencies
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    canvas: {
      findUnique: vi.fn(),
    },
    canvasItem: {
      findUnique: vi.fn(),
    },
  },
}));

describe("Auth Helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("requireAuth", () => {
    it("should return userId and email when session is valid", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: "user123",
          email: "test@example.com",
        },
        expires: "2025-12-31",
      });

      const result = await requireAuth();

      expect(result).toEqual({
        userId: "user123",
        email: "test@example.com",
      });
    });

    it("should throw when session is null", async () => {
      vi.mocked(auth).mockResolvedValue(null);

      await expect(requireAuth()).rejects.toThrow(UnauthorizedError);
    });

    it("should throw when session.user is null", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: null,
        expires: "2025-12-31",
      });

      await expect(requireAuth()).rejects.toThrow(UnauthorizedError);
    });

    it("should throw when session.user.email is missing", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: "user123",
          email: null,
        },
        expires: "2025-12-31",
      });

      await expect(requireAuth()).rejects.toThrow(UnauthorizedError);
    });

    it("should throw when session.user.id is missing (type guard check)", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: null,
          email: "test@example.com",
        },
        expires: "2025-12-31",
      });

      await expect(requireAuth()).rejects.toThrow(UnauthorizedError);
    });

    it('should not use unsafe type casts (no "as string")', async () => {
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: "user123",
          email: "test@example.com",
        },
        expires: "2025-12-31",
      });

      const result = await requireAuth();

      // The result should have properly typed userId without type casting
      expect(typeof result.userId).toBe("string");
      expect(result.userId).toBe("user123");
    });
  });

  describe("requireCanvasOwnership", () => {
    it("should return canvas when user owns it", async () => {
      vi.mocked(prisma.canvas.findUnique).mockResolvedValue({
        userId: "user123",
      } as any);

      const result = await requireCanvasOwnership("canvas123", "user123");

      expect(result).toEqual({ userId: "user123" });
      expect(prisma.canvas.findUnique).toHaveBeenCalledWith({
        where: { id: "canvas123" },
        select: { userId: true },
      });
    });

    it("should throw when canvas not found", async () => {
      vi.mocked(prisma.canvas.findUnique).mockResolvedValue(null);

      await expect(
        requireCanvasOwnership("canvas123", "user123"),
      ).rejects.toThrow(ForbiddenError);
    });

    it("should throw when user does not own canvas", async () => {
      vi.mocked(prisma.canvas.findUnique).mockResolvedValue({
        userId: "otherUser",
      } as any);

      await expect(
        requireCanvasOwnership("canvas123", "user123"),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe("requireItemOwnership", () => {
    it("should return item when user owns the canvas", async () => {
      const mockItem = {
        id: "item123",
        canvas: {
          userId: "user123",
        },
      };

      vi.mocked(prisma.canvasItem.findUnique).mockResolvedValue(
        mockItem as any,
      );

      const result = await requireItemOwnership("item123", "user123");

      expect(result).toEqual(mockItem);
      expect(prisma.canvasItem.findUnique).toHaveBeenCalledWith({
        where: { id: "item123" },
        select: {
          id: true,
          canvasId: true,
          canvas: {
            select: { userId: true },
          },
        },
      });
    });

    it("should throw when item not found", async () => {
      vi.mocked(prisma.canvasItem.findUnique).mockResolvedValue(null);

      await expect(requireItemOwnership("item123", "user123")).rejects.toThrow(
        ForbiddenError,
      );
    });

    it("should throw when user does not own the canvas", async () => {
      vi.mocked(prisma.canvasItem.findUnique).mockResolvedValue({
        id: "item123",
        canvas: {
          userId: "otherUser",
        },
      } as any);

      await expect(requireItemOwnership("item123", "user123")).rejects.toThrow(
        ForbiddenError,
      );
    });
  });
});
