import "../src/lib/env";
import { prisma } from "../src/lib/db";
import { runOutboxWorker } from "../src/lib/outbox/worker";
import { createUploadDeleteHandler } from "../src/lib/uploads/outbox-handler";
import {
  createDeliveryProbeEmailHandler,
  createShareDecisionEmailHandler,
  createShareInvitationEmailHandler,
  createVerificationEmailHandler,
} from "../src/lib/email/outbox-handler";
import {
  createCanvasEventHandler,
  createCanvasRestoreEventHandler,
} from "../src/lib/collaboration/event-outbox-handler";
import {
  createTrashRetentionHandler,
  createVersionRetentionHandler,
  createMaintenanceRetentionHandler,
} from "../src/lib/retention/outbox-handler";
import { createBookmarkRefreshHandler } from "../src/lib/bookmarks/outbox-handler";
import {
  createThumbnailDeleteHandler,
  createThumbnailStoreHandler,
} from "../src/lib/thumbnails/outbox-handler";
import {
  createAccountExportBuildHandler,
  createAccountExportDeleteHandler,
} from "../src/lib/account-export/outbox-handler";
import { accountExportTimeoutMs } from "../src/lib/account-export/constants";

const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

await runOutboxWorker({
  prisma,
  handlers: {
    "upload.delete": createUploadDeleteHandler(prisma),
    "email.delivery-probe": createDeliveryProbeEmailHandler(),
    "email.verification": createVerificationEmailHandler(prisma),
    "email.share-invitation": createShareInvitationEmailHandler(prisma),
    "email.share-decision": createShareDecisionEmailHandler(prisma),
    "canvas.event.publish": createCanvasEventHandler(prisma),
    "canvas.restore.publish": createCanvasRestoreEventHandler(prisma),
    "retention.trash": createTrashRetentionHandler(prisma),
    "retention.versions": createVersionRetentionHandler(prisma),
    "retention.maintenance": createMaintenanceRetentionHandler(prisma),
    "bookmark.refresh": createBookmarkRefreshHandler(prisma),
    "thumbnail.store": createThumbnailStoreHandler(prisma),
    "thumbnail.delete": createThumbnailDeleteHandler(),
    "account-export.build": createAccountExportBuildHandler(prisma),
    "account-export.delete": createAccountExportDeleteHandler(prisma),
  },
  signal: controller.signal,
  leaseMs: Number(process.env.OUTBOX_LEASE_MS || 30_000),
  handlerTimeoutMs: Number(process.env.OUTBOX_HANDLER_TIMEOUT_MS || 15_000),
  handlerTimeoutMsByType: {
    "account-export.build": accountExportTimeoutMs(),
  },
  concurrency: Number(process.env.OUTBOX_CONCURRENCY || 4),
});
await prisma.$disconnect();
