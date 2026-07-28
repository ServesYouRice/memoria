import { describe, expect, it, vi } from "vitest";
import {
  consumeRegistrationAdmission,
  hashRegistrationInvite,
  prepareRegistrationAdmission,
} from "@/lib/auth/registration";

function store(invite: { id: string } | null = null, consumed = 1) {
  return {
    registrationInvite: {
      findFirst: vi.fn().mockResolvedValue(invite),
      updateMany: vi.fn().mockResolvedValue({ count: consumed }),
    },
  };
}

describe("registration admission modes", () => {
  it("allows open registration without consulting invites", async () => {
    const db = store();
    await expect(
      prepareRegistrationAdmission(db, {
        mode: "open",
        email: "USER@example.com",
      }),
    ).resolves.toEqual({ mode: "open" });
    expect(db.registrationInvite.findFirst).not.toHaveBeenCalled();
  });

  it("blocks closed registration before consulting storage", async () => {
    const db = store();
    await expect(
      prepareRegistrationAdmission(db, {
        mode: "closed",
        email: "user@example.com",
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(db.registrationInvite.findFirst).not.toHaveBeenCalled();
  });

  it("accepts a valid invite without exposing lookup details", async () => {
    const db = store({ id: "invite-1" });
    const admission = await prepareRegistrationAdmission(db, {
      mode: "invite",
      email: "USER@example.com",
      inviteToken: "valid-invite-token",
    });
    expect(admission).toEqual({
      mode: "invite",
      email: "user@example.com",
      tokenHash: hashRegistrationInvite("valid-invite-token"),
    });
  });

  it("uses the same denial for missing, invalid, expired, and consumed invites", async () => {
    const db = store(null);
    for (const inviteToken of [undefined, "missing-invite-token"]) {
      await expect(
        prepareRegistrationAdmission(db, {
          mode: "invite",
          email: "user@example.com",
          inviteToken,
        }),
      ).rejects.toMatchObject({
        status: 403,
        detail: "Registration is not available.",
      });
    }
  });

  it("atomically consumes an invite once", async () => {
    const admission = {
      mode: "invite" as const,
      email: "user@example.com",
      tokenHash: hashRegistrationInvite("valid-invite-token"),
    };
    await expect(
      consumeRegistrationAdmission(store(null, 1), admission),
    ).resolves.toBeUndefined();
    await expect(
      consumeRegistrationAdmission(store(null, 0), admission),
    ).rejects.toMatchObject({
      status: 403,
    });
  });
});
