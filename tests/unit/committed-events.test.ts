import { describe, expect, it, vi } from "vitest";
import { toCommittedEventEnvelope } from "@/lib/collaboration/committed-events";
import { createCanvasEventHandler } from "@/lib/collaboration/event-outbox-handler";

const event = {
  id: "clevent12345678901234567890",
  sequence: 42n,
  canvasId: "clcanvas123456789012345678",
  actorId: "user-1",
  entityId: "clitem12345678901234567890",
  entityVersion: 3,
  operation: "deleted",
  permissionScope: "VIEW",
  schemaVersion: 1,
  createdAt: new Date("2026-07-28T20:00:00.000Z"),
};

describe("committed canvas events", () => {
  it("serializes a versioned deletion tombstone with a replay cursor", () => {
    expect(toCommittedEventEnvelope(event)).toEqual({
      schemaVersion: 1,
      eventId: event.id,
      cursor: "42",
      canvasId: event.canvasId,
      actorId: "user-1",
      entity: { type: "canvas-item", id: event.entityId, version: 3 },
      operation: "deleted",
      permissionScope: "VIEW",
      committedAt: "2026-07-28T20:00:00.000Z",
    });
  });

  it("publishes the durable event through the canvas Redis channel", async () => {
    const publish = vi.fn().mockResolvedValue(1);
    const prisma = {
      canvasEvent: { findUnique: vi.fn().mockResolvedValue(event) },
      itemPlacement: { findMany: vi.fn().mockResolvedValue([]) },
    } as never;
    const handler = createCanvasEventHandler(prisma, publish);
    await handler({
      id: "cljob123456789012345678901",
      payload: { eventId: event.id },
    } as never);
    expect(publish).toHaveBeenCalledWith(
      `memoria:collaboration:canvas:${event.canvasId}`,
      expect.stringContaining('"type":"event"'),
    );
  });

  it("tells the other canvases that show the item to read it again (IMP-109)", async () => {
    const publish = vi.fn().mockResolvedValue(1);
    const prisma = {
      canvasEvent: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ ...event, operation: "updated" }),
      },
      itemPlacement: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { canvasId: "clother12345678901234567890" },
            { canvasId: "clthird12345678901234567890" },
          ]),
      },
    } as never;
    await createCanvasEventHandler(
      prisma,
      publish,
    )({
      id: "cljob123456789012345678901",
      payload: { eventId: event.id },
    } as never);
    expect(publish).toHaveBeenCalledTimes(3);
    expect(publish).toHaveBeenCalledWith(
      "memoria:collaboration:canvas:clother12345678901234567890",
      expect.stringContaining(
        `"payload":{"type":"placement-changed","itemId":"${event.entityId}"}`,
      ),
    );
  });
});
