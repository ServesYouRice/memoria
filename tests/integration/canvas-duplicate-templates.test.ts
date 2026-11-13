import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { OutboxJob } from "@/generated/prisma/client";

const session = vi.hoisted(() => ({ user: { id: "", email: "" } }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => session) }));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));

import { prisma } from "@/lib/db";
import { POST as duplicateRoute } from "@/app/api/v1/canvases/[canvasId]/duplicate/route";
import { POST as useTemplateRoute } from "@/app/api/v1/templates/[templateId]/use/route";
import {
  UPLOAD_COPY_JOB,
  createUploadCopyHandler,
} from "@/lib/uploads/copy-upload";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import { findBuiltInTemplate } from "@/lib/templates/built-in";

afterAll(async () => {
  await prisma.$disconnect();
});

async function signIn(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `dup-${label}-${randomBytes(6).toString("hex")}@example.com`,
    },
  });
  session.user = { id: user.id, email: user.email };
  return user;
}

function duplicate(canvasId: string, body?: object) {
  return duplicateRoute(
    new Request(`http://localhost/api/v1/canvases/${canvasId}/duplicate`, {
      method: "POST",
      ...(body
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    }) as never,
    { params: Promise.resolve({ canvasId }) },
  );
}

function useTemplate(templateId: string, body: object = {}) {
  return useTemplateRoute(
    new Request(`http://localhost/api/v1/templates/${templateId}/use`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ templateId }) },
  );
}

const box = (x: number) => ({
  positionX: x,
  positionY: 0,
  width: 100,
  height: 80,
});

describe("Duplicate canvas (IMP-098, PostgreSQL)", () => {
  it("copies every live item, joins arrows to the copies, copies pictures, and leaves shares behind", async () => {
    const user = await signIn("owner");
    const friend = await prisma.user.create({
      data: {
        email: `dup-friend-${randomBytes(6).toString("hex")}@example.com`,
      },
    });
    const source = await prisma.canvas.create({
      data: { name: "Trip", userId: user.id, zoomLevel: 1.5 },
    });
    await prisma.canvasShare.create({
      data: {
        canvasId: source.id,
        email: friend.email,
        recipientId: friend.id,
        role: "EDIT",
      },
    });
    const asset = await prisma.uploadAsset.create({
      data: {
        userId: user.id,
        canvasId: source.id,
        storageKey: `uploads/${user.id}/photo-${randomBytes(4).toString("hex")}.png`,
        storageMode: "local",
        filename: "photo.png",
        mimeType: "image/png",
        size: 1234,
        status: "ACTIVE",
      },
    });
    const make = (type: string, x: number, content: object, extra = {}) =>
      prisma.canvasItem.create({
        data: {
          canvasId: source.id,
          type: type as never,
          ...box(x),
          content,
          createdById: user.id,
          ...extra,
        },
      });
    const a = await make("NOTE", 0, { text: "<p>Flights</p>", color: "blue" });
    const b = await make("NOTE", 300, { text: "<p>Hotel</p>" });
    await make("FRAME", -50, { title: "Plan" }, { width: 600, height: 300 });
    await make("IMAGE", 0, {
      url: `/api/v1/uploads/${asset.id}`,
      filename: "photo.png",
    });
    await make("NOTE", 600, { text: "<p>Gone</p>" }, { deletedAt: new Date() });
    await make("ARROW", 100, {
      startItemId: a.id,
      endItemId: b.id,
      label: "then",
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 200, y: 0 },
    });
    await prisma.comment.create({
      data: { itemId: a.id, userId: user.id, content: "Book soon" },
    });
    const quotaBefore = await prisma.uploadQuota.findUnique({
      where: { userId: user.id },
    });

    const response = await duplicate(source.id);
    expect(response.status).toBe(201);
    const copy = await response.json();
    expect(copy).toMatchObject({
      name: "Copy of Trip",
      itemCount: 5,
      pictureCount: 1,
    });

    const canvas = await prisma.canvas.findUniqueOrThrow({
      where: { id: copy.id },
      include: { items: true, shares: true, versions: true },
    });
    expect(canvas).toMatchObject({ userId: user.id, zoomLevel: 1.5 });
    expect(canvas.shares).toEqual([]);
    expect(canvas.versions).toEqual([]);
    expect(canvas.items.map((item) => item.type).sort()).toEqual([
      "ARROW",
      "FRAME",
      "IMAGE",
      "NOTE",
      "NOTE",
    ]);
    const notes = canvas.items.filter((item) => item.type === "NOTE");
    const flights = notes.find((n) =>
      JSON.stringify(n.content).includes("Flights"),
    )!;
    const hotel = notes.find((n) =>
      JSON.stringify(n.content).includes("Hotel"),
    )!;
    expect(flights.positionX).toBe(0);
    expect(flights.content).toMatchObject({ color: "blue" });
    const arrow = canvas.items.find((item) => item.type === "ARROW")!;
    expect(arrow.content).toMatchObject({
      startItemId: flights.id,
      endItemId: hotel.id,
      label: "then",
    });
    // The arrow is a real link on the copy (IMP-095 trigger).
    expect(
      await prisma.itemConnection.count({ where: { canvasId: copy.id } }),
    ).toBe(1);
    expect(await prisma.comment.count({ where: { itemId: flights.id } })).toBe(
      0,
    );

    // The picture has its own upload in the copy, charged to the owner.
    const image = canvas.items.find((item) => item.type === "IMAGE")!;
    const copiedId = /\/api\/v1\/uploads\/(\w+)$/.exec(
      (image.content as { url: string }).url,
    )![1]!;
    expect(copiedId).not.toBe(asset.id);
    const target = await prisma.uploadAsset.findUniqueOrThrow({
      where: { id: copiedId },
    });
    expect(target).toMatchObject({
      canvasId: copy.id,
      userId: user.id,
      status: "PENDING",
      size: 1234,
    });
    const quotaAfter = await prisma.uploadQuota.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(Number(quotaAfter.totalBytes)).toBe(
      Number(quotaBefore?.totalBytes ?? 0) + 1234,
    );

    // The copy job writes the file once, then the picture shows.
    const job = (await prisma.outboxJob.findFirstOrThrow({
      where: {
        type: UPLOAD_COPY_JOB,
        dedupeKey: `${UPLOAD_COPY_JOB}:${copiedId}`,
      },
    })) as OutboxJob;
    const write = vi.fn(async () => undefined);
    const storage = {
      read: vi.fn(async () => ({
        body: new Blob([new Uint8Array([1, 2, 3])]).stream(),
        etag: "x",
      })),
      write,
    };
    const handler = createUploadCopyHandler(prisma, storage as never);
    await handler(job);
    await handler(job);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(
      "local",
      target.storageKey,
      Buffer.from([1, 2, 3]),
      "image/png",
      undefined,
    );
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: copiedId } }))
        .status,
    ).toBe("ACTIVE");
  });

  it("lets only the owner duplicate", async () => {
    const owner = await signIn("only-owner");
    const source = await prisma.canvas.create({
      data: { name: "Mine", userId: owner.id },
    });
    const editor = await signIn("editor");
    await prisma.canvasShare.create({
      data: {
        canvasId: source.id,
        email: editor.email,
        recipientId: editor.id,
        role: "EDIT",
      },
    });
    expect((await duplicate(source.id)).status).toBe(403);
    await signIn("stranger");
    expect([403, 404]).toContain((await duplicate(source.id)).status);
    expect(await prisma.canvas.count({ where: { userId: editor.id } })).toBe(0);
  });

  it("stops at the canvas limit with a clear message and changes nothing", async () => {
    const user = await signIn("full");
    await prisma.canvas.createMany({
      data: Array.from({ length: LAUNCH_LIMITS.canvasesPerUser }, (_, i) => ({
        name: `C${i}`,
        userId: user.id,
      })),
    });
    const [first] = await prisma.canvas.findMany({
      where: { userId: user.id },
      take: 1,
    });
    const response = await duplicate(first!.id);
    expect(response.status).toBe(422);
    expect((await response.json()).detail).toContain("limit");
    const fromTemplate = await useTemplate("todo-list");
    expect(fromTemplate.status).toBe(422);
    expect(await prisma.canvas.count({ where: { userId: user.id } })).toBe(
      LAUNCH_LIMITS.canvasesPerUser,
    );
  });
});

describe("New canvas from a template (IMP-098, PostgreSQL)", () => {
  it("makes the person's own canvas holding the template's items and links", async () => {
    const user = await signIn("template");
    const response = await useTemplate("project-timeline", { name: "Launch" });
    expect(response.status).toBe(201);
    const created = await response.json();
    const template = findBuiltInTemplate("project-timeline")!;
    expect(created).toMatchObject({
      name: "Launch",
      itemCount: template.items.length,
    });
    const canvas = await prisma.canvas.findUniqueOrThrow({
      where: { id: created.id },
      include: { items: true },
    });
    expect(canvas.userId).toBe(user.id);
    expect(canvas.items).toHaveLength(template.items.length);
    expect(
      await prisma.itemConnection.count({ where: { canvasId: canvas.id } }),
    ).toBe(4);
    expect((await useTemplate("no-such-template")).status).toBe(404);
  });
});
