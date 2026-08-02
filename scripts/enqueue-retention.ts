import { prisma } from "../src/lib/db";
import { enqueueOutboxJob } from "../src/lib/outbox/enqueue";

const day = new Date().toISOString().slice(0, 10);
await prisma.$transaction(async (tx) => {
  await enqueueOutboxJob(tx, {
    type: "retention.trash",
    payload: {},
    dedupeKey: `retention.trash:${day}`,
  });
  await enqueueOutboxJob(tx, {
    type: "retention.versions",
    payload: {},
    dedupeKey: `retention.versions:${day}`,
  });
  await enqueueOutboxJob(tx, {
    type: "retention.maintenance",
    payload: {},
    dedupeKey: `retention.maintenance:${day}`,
  });
});
console.warn(`Queued bounded retention jobs for ${day}.`);
await prisma.$disconnect();
