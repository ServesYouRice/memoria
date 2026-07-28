import { createHash } from "crypto";
import { ForbiddenError } from "@/lib/errors";

export type RegistrationMode = "open" | "invite" | "closed";

export type RegistrationAdmission =
  { mode: "open" } | { mode: "invite"; email: string; tokenHash: string };

type InviteReader = {
  registrationInvite: {
    findFirst(args: {
      where: {
        email: string;
        tokenHash: string;
        usedAt: null;
        expiresAt: { gt: Date };
      };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

type InviteConsumer = {
  registrationInvite: {
    updateMany(args: {
      where: {
        email: string;
        tokenHash: string;
        usedAt: null;
        expiresAt: { gt: Date };
      };
      data: { usedAt: Date };
    }): Promise<{ count: number }>;
  };
};

const unavailable = () => new ForbiddenError("Registration is not available.");

export function hashRegistrationInvite(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function prepareRegistrationAdmission(
  store: InviteReader,
  input: {
    mode: RegistrationMode;
    email: string;
    inviteToken?: string;
    now?: Date;
  },
): Promise<RegistrationAdmission> {
  if (input.mode === "closed") throw unavailable();
  if (input.mode === "open") return { mode: "open" };
  if (!input.inviteToken) throw unavailable();

  const email = input.email.toLowerCase();
  const tokenHash = hashRegistrationInvite(input.inviteToken);
  const invite = await store.registrationInvite.findFirst({
    where: {
      email,
      tokenHash,
      usedAt: null,
      expiresAt: { gt: input.now ?? new Date() },
    },
    select: { id: true },
  });
  if (!invite) throw unavailable();
  return { mode: "invite", email, tokenHash };
}

export async function consumeRegistrationAdmission(
  store: InviteConsumer,
  admission: RegistrationAdmission,
  now = new Date(),
): Promise<void> {
  if (admission.mode === "open") return;
  const result = await store.registrationInvite.updateMany({
    where: {
      email: admission.email,
      tokenHash: admission.tokenHash,
      usedAt: null,
      expiresAt: { gt: now },
    },
    data: { usedAt: now },
  });
  if (result.count !== 1) throw unavailable();
}
