/**
 * IMP-152 — password-reset mail goes through the outbox and a repeated job
 * sends it once.
 */
import { describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/agents/crypto";
import {
  PASSWORD_RESET_EMAIL_JOB,
  createPasswordResetEmailHandler,
} from "@/lib/email/outbox-handler";

const resetTokenId = "clreset1234567890123456789";

function job() {
  return {
    id: "cldelivery12345678901234567",
    type: PASSWORD_RESET_EMAIL_JOB,
    payload: { resetTokenId },
  } as never;
}

/** A token row that the handler's own writes update, like the database. */
function store(row: Record<string, unknown>) {
  const state = { ...row };
  return {
    state,
    prisma: {
      passwordResetToken: {
        findUnique: vi.fn(async () => ({ ...state })),
        updateMany: vi.fn(
          async (args: {
            where: { deliveredAt: null };
            data: Record<string, unknown>;
          }) => {
            if (state.deliveredAt !== null) return { count: 0 };
            Object.assign(state, args.data);
            return { count: 1 };
          },
        ),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ name: "Ada" }) },
    },
  };
}

describe("password-reset outbox delivery", () => {
  it("sends once with a stable delivery id, also when the job runs twice", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { prisma, state } = store({
      email: "ada@example.com",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      deliveredAt: null,
      deliverySecret: encryptSecret("raw-reset-value"),
    });
    const handler = createPasswordResetEmailHandler(prisma as never, send);

    await handler(job());
    await handler(job());

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      { email: "ada@example.com", name: "Ada" },
      expect.objectContaining({
        userName: "Ada",
        resetUrl: expect.stringMatching(
          /\/auth\/reset-password\?token=raw-reset-value$/,
        ),
      }),
      "cldelivery12345678901234567",
      undefined,
    );
    // Delivered: the raw token is dropped from the row.
    expect(state.deliveredAt).toBeInstanceOf(Date);
    expect(state.deliverySecret).toBeNull();
  });

  it("treats a used or expired token as finished", async () => {
    const send = vi.fn();
    for (const row of [
      { usedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
      { usedAt: null, expiresAt: new Date(0) },
    ]) {
      const { prisma } = store({
        email: "ada@example.com",
        deliveredAt: null,
        deliverySecret: encryptSecret("raw-reset-value"),
        ...row,
      });
      await createPasswordResetEmailHandler(prisma as never, send)(job());
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("leaves the job to retry when the provider fails", async () => {
    const send = vi.fn().mockRejectedValue(new Error("provider down"));
    const { prisma, state } = store({
      email: "ada@example.com",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      deliveredAt: null,
      deliverySecret: encryptSecret("raw-reset-value"),
    });
    await expect(
      createPasswordResetEmailHandler(prisma as never, send)(job()),
    ).rejects.toThrow("provider down");
    expect(state.deliveredAt).toBeNull();
    expect(state.deliverySecret).not.toBeNull();
  });

  it("rejects a payload carrying anything but the token id", async () => {
    const { prisma } = store({});
    await expect(
      createPasswordResetEmailHandler(
        prisma as never,
        vi.fn(),
      )({
        id: "job",
        payload: { resetTokenId, token: "raw" },
      } as never),
    ).rejects.toThrow();
  });
});
