import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  executeRaw: vi.fn(),
  userFindUniqueOrThrow: vi.fn(),
  userUpdate: vi.fn(),
  preferenceFindMany: vi.fn(),
  archiveRecapStaleLinks: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRaw: mocks.executeRaw,
    user: {
      findUniqueOrThrow: mocks.userFindUniqueOrThrow,
      update: mocks.userUpdate,
    },
    notificationPreference: { findMany: mocks.preferenceFindMany },
  },
}));
vi.mock("@/lib/recap/archive-stale", () => ({
  archiveRecapStaleLinks: mocks.archiveRecapStaleLinks,
}));

import { POST as opened } from "@/app/api/v1/items/[itemId]/opened/route";
import {
  GET as getSettings,
  PATCH as patchSettings,
} from "@/app/api/v1/recaps/settings/route";
import { POST as archive } from "@/app/api/v1/recaps/[recapId]/archive/route";
import {
  GET as getPreferences,
  PUT as putPreference,
} from "@/app/api/v1/notifications/preferences/route";

function request(url: string, method = "GET", body?: unknown): NextRequest {
  const req = new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  (req as any).nextUrl = new URL(req.url);
  return req as unknown as NextRequest;
}

const params = <T>(value: T) => ({ params: Promise.resolve(value) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user-1", email: "a@b.c" } });
});

describe("POST /api/v1/items/:itemId/opened (IMP-070)", () => {
  it("requires a session", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await opened(
      request("/api/v1/items/i1/opened", "POST"),
      params({ itemId: "i1" }),
    );
    expect(response.status).toBe(401);
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it("records the open for the owner's live link", async () => {
    mocks.executeRaw.mockResolvedValue(1);
    const response = await opened(
      request("/api/v1/items/i1/opened", "POST"),
      params({ itemId: "i1" }),
    );
    expect(response.status).toBe(204);
    const [, ...values] = mocks.executeRaw.mock.calls[0]!;
    expect(values).toEqual(["i1", "user-1"]);
  });

  it("answers 404 for a link that is not the caller's", async () => {
    mocks.executeRaw.mockResolvedValue(0);
    const response = await opened(
      request("/api/v1/items/i9/opened", "POST"),
      params({ itemId: "i9" }),
    );
    expect(response.status).toBe(404);
  });
});

describe("/api/v1/recaps/settings (IMP-070)", () => {
  it("reads the recap settings", async () => {
    mocks.userFindUniqueOrThrow.mockResolvedValue({
      weeklyRecapEmail: false,
      staleLinkWeeks: 6,
    });
    const response = await getSettings(request("/api/v1/recaps/settings"), {});
    expect(await response.json()).toEqual({
      weeklyRecapEmail: false,
      staleLinkWeeks: 6,
    });
  });

  it("saves the email opt-in and the stale threshold for the session user", async () => {
    mocks.userUpdate.mockResolvedValue({
      weeklyRecapEmail: true,
      staleLinkWeeks: 8,
    });
    const response = await patchSettings(
      request("/api/v1/recaps/settings", "PATCH", {
        weeklyRecapEmail: true,
        staleLinkWeeks: 8,
      }),
      {},
    );
    expect(response.status).toBe(200);
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { weeklyRecapEmail: true, staleLinkWeeks: 8 },
      select: { weeklyRecapEmail: true, staleLinkWeeks: true },
    });
  });

  it("rejects out-of-range thresholds and unknown fields", async () => {
    for (const body of [
      { staleLinkWeeks: 0 },
      { staleLinkWeeks: 53 },
      { staleLinkWeeks: 2.5 },
      {},
      { weeklyRecapEmail: true, userId: "user-2" },
    ]) {
      const response = await patchSettings(
        request("/api/v1/recaps/settings", "PATCH", body),
        {},
      );
      expect(response.status).toBe(400);
    }
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/recaps/:recapId/archive (IMP-070)", () => {
  it("archives for the session user and returns the change set to undo", async () => {
    mocks.archiveRecapStaleLinks.mockResolvedValue({
      changeSetId: "cs-1",
      archivedItemCount: 3,
    });
    const response = await archive(
      request("/api/v1/recaps/r1/archive", "POST"),
      params({ recapId: "r1" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      changeSetId: "cs-1",
      archivedItemCount: 3,
    });
    expect(mocks.archiveRecapStaleLinks).toHaveBeenCalledWith({
      userId: "user-1",
      recapId: "r1",
    });
  });
});

describe("notification preferences and the weekly recap", () => {
  it("does not list the recap as a per-type preference", async () => {
    mocks.preferenceFindMany.mockResolvedValue([]);
    const response = await getPreferences(
      request("/api/v1/notifications/preferences"),
      {},
    );
    const body = await response.json();
    expect(
      body.preferences.map((preference: { type: string }) => preference.type),
    ).not.toContain("WEEKLY_RECAP");
  });

  it("refuses to store a recap preference there", async () => {
    const response = await putPreference(
      request("/api/v1/notifications/preferences", "PUT", {
        type: "WEEKLY_RECAP",
        inAppEnabled: false,
        emailEnabled: true,
      }),
      {},
    );
    expect(response.status).toBe(400);
  });
});
