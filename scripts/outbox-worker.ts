import "../src/lib/env";
import { prisma } from "../src/lib/db";
import { runOutboxWorker } from "../src/lib/outbox/worker";
import { createUploadDeleteHandler } from "../src/lib/uploads/outbox-handler";
import { createVerificationEmailHandler } from "../src/lib/email/outbox-handler";
import { createCanvasEventHandler } from "../src/lib/collaboration/event-outbox-handler";
import {
  createTrashRetentionHandler,
  createVersionRetentionHandler,
} from "../src/lib/retention/outbox-handler";

const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

await runOutboxWorker({
  prisma,
  handlers: {
    "upload.delete": createUploadDeleteHandler(prisma),
    "email.verification": createVerificationEmailHandler(prisma),
    "canvas.event.publish": createCanvasEventHandler(prisma),
    "retention.trash": createTrashRetentionHandler(prisma),
    "retention.versions": createVersionRetentionHandler(prisma),
  },
  signal: controller.signal,
});
await prisma.$disconnect();
