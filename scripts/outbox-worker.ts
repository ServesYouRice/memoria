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
import {
  createAutoRetentionHandler,
  createAutoSnapshotHandler,
} from "../src/lib/versions/outbox-handler";
import {
  AUTO_RETENTION_JOB,
  AUTO_SNAPSHOT_JOB,
} from "../src/lib/versions/policy";
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
import {
  UPLOAD_NOTE_JOB,
  UPLOAD_NOTE_TIMEOUT_MS,
  createUploadNoteHandler,
} from "../src/lib/uploads/upload-note";
import {
  LINK_ENRICH_JOB,
  LINK_ENRICH_TIMEOUT_MS,
  createLinkEnrichmentHandler,
} from "../src/lib/services/link-enrichment";
import {
  HOME_BOARD_JOB,
  createHomeBoardProposalHandler,
  enqueueHomeBoardProposal,
} from "../src/lib/agents/home-board";
import {
  RECAP_EMAIL_JOB,
  RECAP_SWEEP_JOB,
  RECAP_USER_JOB,
  RECAP_USER_TIMEOUT_MS,
  createWeeklyRecapEmailHandler,
  createWeeklyRecapHandler,
  createWeeklyRecapSweepHandler,
} from "../src/lib/recap/weekly-recap";

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
    [AUTO_SNAPSHOT_JOB]: createAutoSnapshotHandler(prisma),
    [AUTO_RETENTION_JOB]: createAutoRetentionHandler(prisma),
    "bookmark.refresh": createBookmarkRefreshHandler(prisma),
    "thumbnail.store": createThumbnailStoreHandler(prisma),
    "thumbnail.delete": createThumbnailDeleteHandler(),
    "account-export.build": createAccountExportBuildHandler(prisma),
    "account-export.delete": createAccountExportDeleteHandler(prisma),
    [UPLOAD_NOTE_JOB]: createUploadNoteHandler(prisma),
    // An enriched Inbox link gets a suggested home board (IMP-066).
    [LINK_ENRICH_JOB]: createLinkEnrichmentHandler(prisma, {
      afterEnriched: async (tx, event) => {
        await enqueueHomeBoardProposal(tx, event);
      },
    }),
    [HOME_BOARD_JOB]: createHomeBoardProposalHandler(prisma),
    [RECAP_SWEEP_JOB]: createWeeklyRecapSweepHandler(prisma),
    [RECAP_USER_JOB]: createWeeklyRecapHandler(prisma),
    [RECAP_EMAIL_JOB]: createWeeklyRecapEmailHandler(prisma),
  },
  signal: controller.signal,
  leaseMs: Number(process.env.OUTBOX_LEASE_MS || 30_000),
  handlerTimeoutMs: Number(process.env.OUTBOX_HANDLER_TIMEOUT_MS || 15_000),
  handlerTimeoutMsByType: {
    "account-export.build": accountExportTimeoutMs(),
    [UPLOAD_NOTE_JOB]: UPLOAD_NOTE_TIMEOUT_MS,
    [LINK_ENRICH_JOB]: LINK_ENRICH_TIMEOUT_MS,
    [RECAP_USER_JOB]: RECAP_USER_TIMEOUT_MS,
  },
  concurrency: Number(process.env.OUTBOX_CONCURRENCY || 4),
});
await prisma.$disconnect();
