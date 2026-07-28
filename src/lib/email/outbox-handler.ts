import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { OutboxHandler } from "@/lib/outbox/types";
import { decryptSecret } from "@/lib/agents/crypto";
import { sendEmailVerification } from "@/lib/email";
import { env } from "@/lib/env";

const payloadSchema = z.object({ verificationId: z.string().cuid() }).strict();

export function createVerificationEmailHandler(
  prisma: PrismaClient,
  send = sendEmailVerification,
): OutboxHandler {
  return async (job) => {
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
    );
  };
}
