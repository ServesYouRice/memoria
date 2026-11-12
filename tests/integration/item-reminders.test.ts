import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { OutboxJob } from "@/generated/prisma/client";

const session = vi.hoisted(() => ({ user: { id: "", email: "" } }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => session) }));

import { prisma } from "@/lib/db";
import {
  REMINDER_EMAIL_JOB,
  REMINDER_FIRE_JOB,
  createReminderEmailHandler,
  createReminderFireHandler,
  createReminderSweepHandler,
  enqueueReminderSweep,
  pickSomethingOld,
  reminderFireDedupeKey,
} from "@/lib/reminders/item-reminders";
import {
  DELETE as cancelRoute,
  PUT as setRoute,
} from "@/app/api/v1/items/[itemId]/reminder/route";
import { GET as listRoute } from "@/app/api/v1/reminders/route";
import { GET as notificationsRoute } from "@/app/api/v1/notifications/route";
import { GET as preferencesRoute } from "@/app/api/v1/notifications/preferences/route";

afterAll(async () => {
  await prisma.$disconnect();
});

const DAY = 86_400_000;

async function seedUser(label: string) {
  return prisma.user.create({
    data: {
      email: `reminder-${label}-${randomBytes(6).toString("hex")}@example.com`,
    },
  });
}

async function seedItem(ownerId: string, title = "Hotel") {
  const canvas = await prisma.canvas.create({
    data: { name: "Trip", userId: ownerId },
  });
  const item = await prisma.canvasItem.create({
    data: {
      canvasId: canvas.id,
      type: "BOOKMARK",
      positionX: 0,
      positionY: 0,
      width: 200,
      height: 100,
      content: { url: "https://example.com/hotel", title },
      createdById: ownerId,
    },
  });
  return { canvas, item };
}

function signIn(user: { id: string; email: string }) {
  session.user = { id: user.id, email: user.email };
}

function setReminder(itemId: string, remindAt: Date) {
  return setRoute(
    new Request(`http://localhost/api/v1/items/${itemId}/reminder`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ remindAt: remindAt.toISOString() }),
    }) as never,
    { params: Promise.resolve({ itemId }) },
  );
}

function job(type: string, payload: Record<string, unknown>): OutboxJob {
  return {
    id: `job-${randomBytes(4).toString("hex")}`,
    type,
    payload,
  } as unknown as OutboxJob;
}

async function fireJobsFor(reminderId: string) {
  return prisma.outboxJob.findMany({
    where: {
      type: REMINDER_FIRE_JOB,
      payload: { path: ["reminderId"], equals: reminderId },
    },
  });
}

describe("Remind me (IMP-097, PostgreSQL)", () => {
  it("sets a reminder, fires it once on the day, and opens the item", async () => {
    const user = await seedUser("owner");
    signIn(user);
    const { canvas, item } = await seedItem(user.id);
    const tomorrow = new Date(Date.now() + DAY);

    const set = await setReminder(item.id, tomorrow);
    expect(set.status).toBe(200);
    const listed = await (
      await listRoute(new Request("http://localhost") as never, {} as never)
    ).json();
    expect(listed.reminders).toEqual([
      expect.objectContaining({
        itemId: item.id,
        title: "Hotel",
        canvasName: "Trip",
        remindAt: tomorrow.toISOString(),
      }),
    ]);
    const reminder = await prisma.itemReminder.findUniqueOrThrow({
      where: { userId_itemId: { userId: user.id, itemId: item.id } },
    });

    // Not due yet: the sweep queues nothing for it.
    await createReminderSweepHandler(prisma)(job("reminders.sweep", {}));
    expect(await fireJobsFor(reminder.id)).toHaveLength(0);

    // On the day: two sweeps queue one job; the job run twice fires once.
    const onTheDay = () => new Date(tomorrow.getTime() + 60_000);
    await createReminderSweepHandler(
      prisma,
      onTheDay,
    )(job("reminders.sweep", {}));
    await createReminderSweepHandler(
      prisma,
      onTheDay,
    )(job("reminders.sweep", {}));
    const jobs = await fireJobsFor(reminder.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.dedupeKey).toBe(
      reminderFireDedupeKey(reminder.id, tomorrow),
    );
    const fire = createReminderFireHandler(prisma, onTheDay);
    await fire(jobs[0]!);
    await fire(jobs[0]!);

    const notifications = await prisma.notification.findMany({
      where: { recipientId: user.id, type: "ITEM_REMINDER" },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      canvasId: canvas.id,
      itemId: item.id,
      subject: "Reminder: Hotel",
    });
    const inbox = await (
      await notificationsRoute(
        new Request("http://localhost/api/v1/notifications"),
      )
    ).json();
    expect(inbox.notifications[0].action).toEqual({
      href: `/canvas/${canvas.id}?item=${item.id}`,
      label: "Open item",
    });
    // Email is opt-in for reminders: none was queued.
    expect(
      await prisma.outboxJob.count({
        where: {
          type: REMINDER_EMAIL_JOB,
          payload: { path: ["reminderId"], equals: reminder.id },
        },
      }),
    ).toBe(0);
    // A fired reminder leaves the upcoming list.
    const after = await (
      await listRoute(new Request("http://localhost") as never, {} as never)
    ).json();
    expect(after.reminders).toEqual([]);
  });

  it("emails only when the person turned reminder emails on", async () => {
    const user = await seedUser("email");
    signIn(user);
    const prefs = await (
      await preferencesRoute(
        new Request("http://localhost") as never,
        {} as never,
      )
    ).json();
    expect(prefs.preferences).toContainEqual({
      type: "ITEM_REMINDER",
      inAppEnabled: true,
      emailEnabled: false,
    });
    await prisma.notificationPreference.create({
      data: { userId: user.id, type: "ITEM_REMINDER", emailEnabled: true },
    });
    const { item } = await seedItem(user.id, "Flights");
    const at = new Date(Date.now() + DAY);
    await setReminder(item.id, at);
    const later = () => new Date(at.getTime() + 1000);
    await createReminderSweepHandler(prisma, later)(job("reminders.sweep", {}));
    const reminder = await prisma.itemReminder.findFirstOrThrow({
      where: { itemId: item.id },
    });
    await createReminderFireHandler(
      prisma,
      later,
    )((await fireJobsFor(reminder.id))[0]!);
    const emailJobs = await prisma.outboxJob.findMany({
      where: {
        type: REMINDER_EMAIL_JOB,
        payload: { path: ["reminderId"], equals: reminder.id },
      },
    });
    expect(emailJobs).toHaveLength(1);
    const send = vi.fn(async () => undefined);
    await createReminderEmailHandler(prisma, send as never)(emailJobs[0]!);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: { email: user.email, name: undefined },
        subject: "Reminder: Flights",
      }),
    );
  });

  it("moving a reminder makes the old job a no-op; cancelling stops it", async () => {
    const user = await seedUser("move");
    signIn(user);
    const { item } = await seedItem(user.id);
    const first = new Date(Date.now() + DAY);
    await setReminder(item.id, first);
    const reminder = await prisma.itemReminder.findFirstOrThrow({
      where: { itemId: item.id },
    });
    const later = () => new Date(first.getTime() + 7 * DAY);
    await setReminder(item.id, new Date(Date.now() + 3 * DAY));
    // A job queued for the first time does nothing once the time moved.
    await createReminderFireHandler(
      prisma,
      later,
    )(
      job(REMINDER_FIRE_JOB, {
        reminderId: reminder.id,
        remindAt: first.toISOString(),
      }),
    );
    expect(
      await prisma.notification.count({ where: { recipientId: user.id } }),
    ).toBe(0);

    const cancelled = await cancelRoute(
      new Request("http://localhost") as never,
      {
        params: Promise.resolve({ itemId: item.id }),
      },
    );
    expect(cancelled.status).toBe(204);
    await createReminderSweepHandler(prisma, later)(job("reminders.sweep", {}));
    expect(await fireJobsFor(reminder.id)).toHaveLength(0);
  });

  it("refuses times in the past and items the caller cannot see", async () => {
    const owner = await seedUser("owner2");
    const stranger = await seedUser("stranger");
    const { item } = await seedItem(owner.id);
    signIn(owner);
    expect(
      (await setReminder(item.id, new Date(Date.now() - DAY))).status,
    ).toBe(400);
    signIn(stranger);
    expect(
      (await setReminder(item.id, new Date(Date.now() + DAY))).status,
    ).toBe(404);
    expect(
      await prisma.itemReminder.count({ where: { itemId: item.id } }),
    ).toBe(0);
  });

  it("losing access or deleting the item cancels the reminder at fire time", async () => {
    const owner = await seedUser("sharer");
    const guest = await seedUser("guest");
    const { canvas, item } = await seedItem(owner.id);
    const share = await prisma.canvasShare.create({
      data: {
        canvasId: canvas.id,
        email: guest.email,
        recipientId: guest.id,
        role: "VIEW",
      },
    });
    const at = new Date(Date.now() + DAY);
    signIn(guest);
    expect((await setReminder(item.id, at)).status).toBe(200);
    signIn(owner);
    expect((await setReminder(item.id, at)).status).toBe(200);

    await prisma.canvasShare.delete({ where: { id: share.id } });
    signIn(guest);
    const guestList = await (
      await listRoute(new Request("http://localhost") as never, {} as never)
    ).json();
    expect(guestList.reminders).toEqual([]);

    const later = () => new Date(at.getTime() + 1000);
    const guestReminder = await prisma.itemReminder.findUniqueOrThrow({
      where: { userId_itemId: { userId: guest.id, itemId: item.id } },
    });
    await createReminderFireHandler(
      prisma,
      later,
    )(
      job(REMINDER_FIRE_JOB, {
        reminderId: guestReminder.id,
        remindAt: at.toISOString(),
      }),
    );
    expect(
      await prisma.itemReminder.findUniqueOrThrow({
        where: { id: guestReminder.id },
      }),
    ).toMatchObject({ firedAt: null, cancelledAt: expect.any(Date) });
    expect(
      await prisma.notification.count({ where: { recipientId: guest.id } }),
    ).toBe(0);

    // The owner's own reminder is cancelled once the item is deleted.
    await prisma.canvasItem.update({
      where: { id: item.id },
      data: { deletedAt: new Date(), deletedById: owner.id },
    });
    const ownerReminder = await prisma.itemReminder.findUniqueOrThrow({
      where: { userId_itemId: { userId: owner.id, itemId: item.id } },
    });
    await createReminderFireHandler(
      prisma,
      later,
    )(
      job(REMINDER_FIRE_JOB, {
        reminderId: ownerReminder.id,
        remindAt: at.toISOString(),
      }),
    );
    expect(
      await prisma.itemReminder.findUniqueOrThrow({
        where: { id: ownerReminder.id },
      }),
    ).toMatchObject({ firedAt: null, cancelledAt: expect.any(Date) });
    expect(
      await prisma.notification.count({ where: { recipientId: owner.id } }),
    ).toBe(0);
  });

  it("the maintenance cron queues one sweep per 15-minute window", async () => {
    const at = new Date("2030-01-01T10:01:00Z");
    await enqueueReminderSweep(prisma, at);
    await enqueueReminderSweep(prisma, new Date("2030-01-01T10:14:00Z"));
    await enqueueReminderSweep(prisma, new Date("2030-01-01T10:16:00Z"));
    const sweeps = await prisma.outboxJob.findMany({
      where: {
        type: "reminders.sweep",
        dedupeKey: { startsWith: "reminders.sweep:" },
      },
      select: { dedupeKey: true },
    });
    const keys = new Set(sweeps.map((sweep) => sweep.dedupeKey));
    const window = (date: string) =>
      `reminders.sweep:${Math.floor(new Date(date).getTime() / (15 * 60_000))}`;
    expect(keys.has(window("2030-01-01T10:01:00Z"))).toBe(true);
    expect(keys.has(window("2030-01-01T10:16:00Z"))).toBe(true);
    expect(window("2030-01-01T10:01:00Z")).toBe(window("2030-01-01T10:14:00Z"));
  });
});

describe("Something old (IMP-097, PostgreSQL)", () => {
  it("offers an item not opened for 30 days, and another one on request", async () => {
    const user = await seedUser("old");
    const { canvas, item: recent } = await seedItem(user.id, "Recent");
    const make = (title: string) =>
      prisma.canvasItem.create({
        data: {
          canvasId: canvas.id,
          type: "NOTE",
          positionX: 0,
          positionY: 0,
          width: 100,
          height: 100,
          content: { text: `<p>${title}</p>`, plainText: title },
          createdById: user.id,
        },
      });
    const oldNote = await make("Old idea");
    const openedLongAgo = await make("Opened long ago");
    const openedLately = await make("Opened lately");
    const longAgo = new Date(Date.now() - 60 * DAY);
    await prisma.$executeRaw`
      UPDATE "CanvasItem" SET "createdAt" = ${longAgo}
      WHERE "id" IN (${oldNote.id}, ${openedLongAgo.id}, ${openedLately.id})
    `;
    await prisma.canvasItem.update({
      where: { id: openedLongAgo.id },
      data: { lastOpenedAt: new Date(Date.now() - 40 * DAY) },
    });
    await prisma.canvasItem.update({
      where: { id: openedLately.id },
      data: { lastOpenedAt: new Date(Date.now() - 2 * DAY) },
    });

    const seen = new Set<string>();
    const exclude: string[] = [];
    for (;;) {
      const picked = await pickSomethingOld(prisma, {
        userId: user.id,
        exclude,
      });
      if (!picked) break;
      seen.add(picked.title);
      exclude.push(picked.id);
    }
    expect(seen).toEqual(new Set(["Old idea", "Opened long ago"]));
    expect(exclude).not.toContain(recent.id);

    const first = await pickSomethingOld(prisma, { userId: user.id }, () => 0);
    const second = await pickSomethingOld(
      prisma,
      { userId: user.id, exclude: [first!.id] },
      () => 0,
    );
    expect(second!.id).not.toBe(first!.id);
    expect(first!.url).toBe(`/canvas/${canvas.id}?item=${first!.id}`);
  });
});
