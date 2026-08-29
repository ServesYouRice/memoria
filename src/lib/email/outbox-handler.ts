import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { OutboxHandler } from "@/lib/outbox/types";
import { decryptSecret } from "@/lib/agents/crypto";
import { sendEmail, sendEmailVerification } from "@/lib/email";
import { env } from "@/lib/env";
import {
  shareDecisionTemplate,
  shareInvitationTemplate,
} from "@/lib/email/templates";

const payloadSchema = z.object({ verificationId: z.string().cuid() }).strict();

const deliveryProbePayloadSchema = z
  .object({ to: z.string().email() })
  .strict();

export function createDeliveryProbeEmailHandler(
  send = sendEmail,
): OutboxHandler {
  return async (job, context) => {
    const { to } = deliveryProbePayloadSchema.parse(job.payload);
    await send({
      to: { email: to },
      subject: "Memoria delivery probe",
      text: `Memoria successfully delivered the controlled setup probe. Delivery ID: ${job.id}`,
      html: `<p>Memoria successfully delivered the controlled setup probe.</p><p>Delivery ID: <code>${job.id}</code></p>`,
      deliveryId: job.id,
      signal: context?.signal,
    });
  };
}

export function createVerificationEmailHandler(
  prisma: PrismaClient,
  send = sendEmailVerification,
): OutboxHandler {
  return async (job, context) => {
    const { verificationId } = payloadSchema.parse(job.payload);
    const verification = await prisma.emailVerificationToken.findUnique({
      where: { id: verificationId },
      select: {
        email: true,
        expiresAt: true,
        usedAt: true,
        deliverySecret: true,
      },
    });
    if (
      !verification ||
      verification.usedAt ||
      verification.expiresAt <= new Date()
    )
      return;
    if (!verification.deliverySecret)
      throw new Error("Verification delivery secret is unavailable.");
    const user = await prisma.user.findUnique({
      where: { email: verification.email },
      select: { name: true },
    });
    const raw = decryptSecret(verification.deliverySecret);
    await send(
      { email: verification.email, name: user?.name || undefined },
      {
        userName: user?.name || "User",
        verificationUrl: `${env.AUTH_URL}/auth/verify-email?token=${raw}`,
        expiresIn: "24 hours",
      },
      job.id,
      context?.signal,
    );
  };
}

const invitationPayloadSchema = z
  .object({ invitationId: z.string().cuid() })
  .strict();

export function createShareInvitationEmailHandler(
  prisma: PrismaClient,
): OutboxHandler {
  return async (job, context) => {
    const { invitationId } = invitationPayloadSchema.parse(job.payload);
    const invitation = await prisma.canvasShareInvitation.findUnique({
      where: { id: invitationId },
      include: {
        canvas: { select: { name: true } },
        invitedBy: { select: { name: true, email: true } },
      },
    });
    if (
      !invitation ||
      invitation.respondedAt ||
      invitation.expiresAt <= new Date()
    )
      return;
    const recipient = await prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true },
    });
    if (recipient) {
      const preference = await prisma.notificationPreference.findUnique({
        where: {
          userId_type: {
            userId: recipient.id,
            type: "CANVAS_SHARED",
          },
        },
        select: { emailEnabled: true },
      });
      if (preference?.emailEnabled === false) return;
    }
    const rawToken = decryptSecret(invitation.deliverySecret);
    const template = shareInvitationTemplate({
      inviterName: invitation.invitedBy.name || invitation.invitedBy.email,
      canvasName: invitation.canvas.name,
      invitationUrl: `${env.AUTH_URL}/share-invitations/${rawToken}`,
      expiresIn: "7 days",
    });
    await sendEmail({
      to: { email: invitation.email },
      ...template,
      deliveryId: job.id,
      signal: context?.signal,
    });
  };
}

export function createShareDecisionEmailHandler(
  prisma: PrismaClient,
): OutboxHandler {
  return async (job, context) => {
    const { invitationId } = invitationPayloadSchema.parse(job.payload);
    const invitation = await prisma.canvasShareInvitation.findUnique({
      where: { id: invitationId },
      include: {
        canvas: { select: { name: true } },
        invitedBy: { select: { name: true, email: true } },
      },
    });
    if (!invitation?.response || invitation.response === "REVOKED") return;
    const preferenceType =
      invitation.response === "ACCEPTED"
        ? "SHARE_INVITATION_ACCEPTED"
        : "SHARE_INVITATION_DECLINED";
    const preference = await prisma.notificationPreference.findUnique({
      where: {
        userId_type: {
          userId: invitation.invitedById,
          type: preferenceType,
        },
      },
      select: { emailEnabled: true },
    });
    if (preference?.emailEnabled === false) return;
    const template = shareDecisionTemplate({
      recipientEmail: invitation.email,
      canvasName: invitation.canvas.name,
      decision: invitation.response === "ACCEPTED" ? "accepted" : "declined",
    });
    await sendEmail({
      to: {
        email: invitation.invitedBy.email,
        name: invitation.invitedBy.name || undefined,
      },
      ...template,
      deliveryId: job.id,
      signal: context?.signal,
    });
  };
}
