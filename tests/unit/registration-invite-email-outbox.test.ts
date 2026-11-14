/**
 * IMP-153: the queued sign-up invite email. It sends the link for a live
 * invite and quietly does nothing once the invite is cancelled, used or
 * expired, so a retry never mails a dead link.
 */
import { describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/agents/crypto";
import { createRegistrationInviteEmailHandler } from "@/lib/email/outbox-handler";

const inviteId = "clinvite1234567890123456789";

function job(payload: unknown = { inviteId }) {
  return {
    id: "cldelivery12345678901234567",
    type: "email.registration-invite",
    payload,
  } as never;
}

function store(invite: unknown) {
  return {
    registrationInvite: { findUnique: vi.fn().mockResolvedValue(invite) },
  } as never;
}

describe("registration invite email", () => {
  it("mails the sign-up link with a stable delivery id", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await createRegistrationInviteEmailHandler(
      store({
        email: "new@example.com",
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
        usedAt: null,
        deliverySecret: encryptSecret("raw-invite-token"),
      }),
      send,
    )(job());

    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0][0];
    expect(message.to).toEqual({ email: "new@example.com" });
    expect(message.deliveryId).toBe("cldelivery12345678901234567");
    expect(message.subject).toBe("You are invited to Memoria");
    expect(message.text).toContain(
      "/auth/register?inviteToken=raw-invite-token",
    );
    expect(message.text).toContain("email=new%40example.com");
    expect(message.text).toContain("7 days");
  });

  it.each([
    ["cancelled", null],
    [
      "used",
      {
        email: "new@example.com",
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
        deliverySecret: null,
      },
    ],
    [
      "expired",
      {
        email: "new@example.com",
        expiresAt: new Date(0),
        usedAt: null,
        deliverySecret: "unused",
      },
    ],
  ])("sends nothing for a %s invite", async (_label, invite) => {
    const send = vi.fn();
    await createRegistrationInviteEmailHandler(store(invite), send)(job());
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a payload carrying anything but the invite id", async () => {
    await expect(
      createRegistrationInviteEmailHandler(
        store(null),
        vi.fn(),
      )(job({ inviteId, token: "x" })),
    ).rejects.toThrow();
  });
});
