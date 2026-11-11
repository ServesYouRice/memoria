import { randomBytes } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { OutboxJob } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { HOME_BOARD_JOB } from "@/lib/agents/home-board";
import { LINK_ENRICH_JOB } from "@/lib/services/link-enrichment";
import { UPLOAD_NOTE_JOB } from "@/lib/uploads/upload-note";
import {
  createMaintenanceRetentionHandler,
  OUTBOX_PRUNE_KEEP_TYPES,
} from "@/lib/retention/outbox-handler";

afterAll(async () => {
  await prisma.outboxJob.deleteMany({
    where: { dedupeKey: { startsWith: `prune-${tag}:` } },
  });
  await prisma.$disconnect();
});

const DAY = 86_400_000;
const tag = randomBytes(6).toString("hex");
const old = new Date(Date.now() - 30 * DAY);
const recent = new Date(Date.now() - 2 * DAY);

function row(
  name: string,
  type: string,
  status: "PENDING" | "RUNNING" | "COMPLETED" | "DEAD",
  completedAt: Date | null,
) {
  return {
    type,
    payload: {},
    dedupeKey: `prune-${tag}:${name}`,
    status,
    completedAt,
    createdAt: old,
  };
}

describe("completed outbox rows are pruned by maintenance retention", () => {
  it("keeps the job types whose key names a long-lived entity", () => {
    expect([...OUTBOX_PRUNE_KEEP_TYPES].sort()).toEqual(
      [HOME_BOARD_JOB, LINK_ENRICH_JOB, UPLOAD_NOTE_JOB].sort(),
    );
  });

  it("deletes only old COMPLETED rows of job types whose key is never reused", async () => {
    await prisma.outboxJob.createMany({
      data: [
        row("old-completed", "canvas.event.publish", "COMPLETED", old),
        row("old-completed-email", "email.share-invitation", "COMPLETED", old),
        row("recent-completed", "canvas.event.publish", "COMPLETED", recent),
        row("old-pending", "canvas.event.publish", "PENDING", null),
        row("old-running", "canvas.event.publish", "RUNNING", null),
        row("old-dead", "canvas.event.publish", "DEAD", old),
        row("old-home-board", HOME_BOARD_JOB, "COMPLETED", old),
        row("old-link-enrich", LINK_ENRICH_JOB, "COMPLETED", old),
        row("old-upload-note", UPLOAD_NOTE_JOB, "COMPLETED", old),
        // More than one batch of prunable rows.
        ...Array.from({ length: 1100 }, (_, index) =>
          row(`bulk-${index}`, "canvas.event.publish", "COMPLETED", old),
        ),
      ],
    });

    await createMaintenanceRetentionHandler(prisma)({
      id: `job-${tag}`,
      type: "retention.maintenance",
    } as OutboxJob);

    const left = await prisma.outboxJob.findMany({
      where: { dedupeKey: { startsWith: `prune-${tag}:` } },
      select: { dedupeKey: true },
    });
    expect(left.map((job) => job.dedupeKey?.split(":")[1]).sort()).toEqual(
      [
        "old-dead",
        "old-home-board",
        "old-link-enrich",
        "old-pending",
        "old-running",
        "old-upload-note",
        "recent-completed",
      ].sort(),
    );
  });
});
