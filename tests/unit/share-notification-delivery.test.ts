import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/agents/crypto";

const emailMocks = vi.hoisted(() => ({ sendEmail: vi.fn() }));

vi.mock("@/lib/email", () => ({
  sendEmail: emailMocks.sendEmail,
  sendEmailVerification: vi.fn(),
}));

import { createShareInvitationEmailHandler } from "@/lib/email/outbox-handler";

const invitationId = "cjld2cjxh0000qzrmn831i7rn";

function job() {
  return {
    id: "cldelivery12345678901234567",
    type: "email.share-invitation",
    payload: { invitationId },
  } as never;
}

function invitation() {
  return {
    email: "recipient@example.com",
    respondedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    deliverySecret: encryptSecret("raw-invitation-token"),
    canvas: { name: "Launch plan" },
    invitedBy: { name: "Ada", email: "ada@example.com" },
  };
}

describe("share invitation email preferences", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not deliver to an existing user who disabled invitation email", async () => {
    const preferenceFindUnique = vi
      .fn()
      .mockResolvedValue({ emailEnabled: false });
    const prisma = {
      canvasShareInvitation: {
        findUnique: vi.fn().mockResolvedValue(invitation()),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ id: "recipient-1" }) },
      notificationPreference: { findUnique: preferenceFindUnique },
    } as never;

    await createShareInvitationEmailHandler(prisma)(job());

    expect(preferenceFindUnique).toHaveBeenCalledWith({
      where: {
        userId_type: {
          userId: "recipient-1",
          type: "CANVAS_SHARED",
        },
      },
      select: { emailEnabled: true },
    });
    expect(emailMocks.sendEmail).not.toHaveBeenCalled();
  });

  it("delivers an actionable invitation by default", async () => {
    const prisma = {
      canvasShareInvitation: {
        findUnique: vi.fn().mockResolvedValue(invitation()),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ id: "recipient-1" }) },
      notificationPreference: { findUnique: vi.fn().mockResolvedValue(null) },
    } as never;

    await createShareInvitationEmailHandler(prisma)(job());

    expect(emailMocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: { email: "recipient@example.com" },
        html: expect.stringContaining("raw-invitation-token"),
        deliveryId: "cldelivery12345678901234567",
      }),
    );
  });
});
