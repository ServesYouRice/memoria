/**
 * IMP-153 (DEC-024): the owner of this Memoria issues sign-up invites. Only
 * the owner may list, create or cancel them; the link is returned once, only
 * its hash is stored, and the registration admission accepts it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";
import { UnauthorizedError } from "@/lib/errors";

type InviteRow = {
  id: string;
  email: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  deliverySecret: string | null;
  createdAt: Date;
};

const state = vi.hoisted(() => ({
  users: [] as Array<{ id: string; email: string; createdAt: Date }>,
  invites: [] as InviteRow[],
  mailProvider: "console",
  nextId: 0,
}));

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  enqueueOutboxJob: vi.fn(),
}));

function matches(row: InviteRow, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => {
    const field = row[key as keyof InviteRow];
    if (value && typeof value === "object" && "gt" in value) {
      return field instanceof Date && field > (value as { gt: Date }).gt;
    }
    return field === value;
  });
}

const fakePrisma = vi.hoisted(() => {
  const db: Record<string, unknown> = {};
  return db;
});

vi.mock("@/lib/db", () => {
  const pick = (row: InviteRow) => ({
    id: row.id,
    email: row.email,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
  });
  Object.assign(fakePrisma, {
    user: {
      findFirst: vi.fn(async () => {
        const [first] = [...state.users].sort(
          (a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime() ||
            a.id.localeCompare(b.id),
        );
        return first ? { id: first.id } : null;
      }),
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) => {
        const user = state.users.find((entry) => entry.email === where.email);
        return user ? { id: user.id } : null;
      }),
    },
    registrationInvite: {
      create: vi.fn(async ({ data }: { data: Partial<InviteRow> }) => {
        const row: InviteRow = {
          // A cuid-shaped id, so the DELETE route's validation accepts it.
          id: `cinvite${String(state.nextId++).padStart(18, "0")}`,
          email: data.email!,
          tokenHash: data.tokenHash!,
          expiresAt: data.expiresAt!,
          usedAt: null,
          deliverySecret: data.deliverySecret ?? null,
          createdAt: new Date(),
        };
        state.invites.push(row);
        return pick(row);
      }),
      deleteMany: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          const before = state.invites.length;
          state.invites = state.invites.filter((row) => !matches(row, where));
          return { count: before - state.invites.length };
        },
      ),
      findMany: vi.fn(async () =>
        [...state.invites]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map(pick),
      ),
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          const row = state.invites.find((entry) => matches(entry, where));
          return row ? { id: row.id } : null;
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Partial<InviteRow>;
        }) => {
          const rows = state.invites.filter((row) => matches(row, where));
          rows.forEach((row) => Object.assign(row, data));
          return { count: rows.length };
        },
      ),
    },
    $transaction: vi.fn(async (run: (tx: unknown) => unknown) =>
      run(fakePrisma),
    ),
  });
  return { prisma: fakePrisma };
});
vi.mock("@/lib/api/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/env", () => ({
  env: { AUTH_URL: "https://memoria.example", REGISTRATION_MODE: "invite" },
}));
vi.mock("@/lib/agents/crypto", () => ({
  encryptSecret: (value: string) => `enc:${value}`,
}));
vi.mock("@/lib/outbox/enqueue", () => ({
  enqueueOutboxJob: mocks.enqueueOutboxJob,
}));
vi.mock("@/lib/email", () => ({
  getEmailConfig: () => ({ provider: state.mailProvider }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

import { GET, POST } from "@/app/api/v1/registration-invites/route";
import { DELETE } from "@/app/api/v1/registration-invites/[inviteId]/route";
import {
  consumeRegistrationAdmission,
  hashRegistrationInvite,
  prepareRegistrationAdmission,
} from "@/lib/auth/registration";
import { prisma } from "@/lib/db";

const OWNER = { userId: "owner-1", email: "owner@example.com" };
const OTHER = { userId: "user-2", email: "other@example.com" };

function request(url: string, method = "GET", body?: unknown): NextRequest {
  const req = new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  (req as any).nextUrl = new URL(url);
  return req as unknown as NextRequest;
}

const BASE = "https://memoria.example/api/v1/registration-invites";

function create(body: unknown) {
  return POST(request(BASE, "POST", body), undefined as never);
}

function list() {
  return GET(request(BASE), undefined as never);
}

function revoke(inviteId: string) {
  return DELETE(request(`${BASE}/${inviteId}`, "DELETE"), {
    params: Promise.resolve({ inviteId }),
  });
}

function tokenFrom(url: string) {
  return new URL(url).searchParams.get("inviteToken")!;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.users = [
    { id: OWNER.userId, email: OWNER.email, createdAt: new Date("2026-01-01") },
    { id: OTHER.userId, email: OTHER.email, createdAt: new Date("2026-02-01") },
  ];
  state.invites = [];
  state.mailProvider = "console";
  mocks.requireAuth.mockResolvedValue(OWNER);
});

describe("who may manage invites", () => {
  it("answers 401 without a session", async () => {
    mocks.requireAuth.mockRejectedValue(new UnauthorizedError());
    expect((await list()).status).toBe(401);
    expect((await create({ email: "new@example.com" })).status).toBe(401);
  });

  it("hides invites from everyone but the owner", async () => {
    state.invites.push({
      id: "cinviteexisting000000000",
      email: "pending@example.com",
      tokenHash: "hash",
      expiresAt: new Date(Date.now() + 86_400_000),
      usedAt: null,
      deliverySecret: null,
      createdAt: new Date(),
    });
    mocks.requireAuth.mockResolvedValue(OTHER);

    expect((await list()).status).toBe(404);
    expect((await create({ email: "new@example.com" })).status).toBe(404);
    expect((await revoke("cinviteexisting000000000")).status).toBe(404);
    expect(state.invites).toHaveLength(1);
    expect(prisma.registrationInvite.create).not.toHaveBeenCalled();
    expect(prisma.registrationInvite.deleteMany).not.toHaveBeenCalled();
  });
});

describe("creating an invite", () => {
  it("returns the link once and stores only its hash, for 7 days", async () => {
    const before = Date.now();
    const response = await create({ email: " New@Example.com " });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();

    const url = new URL(body.inviteUrl);
    expect(url.origin + url.pathname).toBe(
      "https://memoria.example/auth/register",
    );
    expect(url.searchParams.get("email")).toBe("new@example.com");
    const token = tokenFrom(body.inviteUrl);
    expect(token.length).toBeGreaterThanOrEqual(32);

    expect(state.invites).toHaveLength(1);
    const [row] = state.invites;
    expect(row.email).toBe("new@example.com");
    expect(row.tokenHash).toBe(hashRegistrationInvite(token));
    expect(row.tokenHash).not.toContain(token);
    expect(row.deliverySecret).toBeNull();
    const ttl = row.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(7 * 86_400_000 - 1000);
    expect(ttl).toBeLessThanOrEqual(7 * 86_400_000 + 1000);

    expect(body.emailQueued).toBe(false);
    expect(body.invite).toMatchObject({
      email: "new@example.com",
      status: "pending",
    });
    expect(JSON.stringify(body.invite)).not.toContain(token);
    expect(mocks.enqueueOutboxJob).not.toHaveBeenCalled();
  });

  it("queues the email when a mail provider is set, without the token in the job", async () => {
    state.mailProvider = "smtp";
    const body = await (await create({ email: "new@example.com" })).json();
    const token = tokenFrom(body.inviteUrl);

    expect(body.emailQueued).toBe(true);
    expect(state.invites[0].deliverySecret).toBe(`enc:${token}`);
    expect(mocks.enqueueOutboxJob).toHaveBeenCalledWith(prisma, {
      type: "email.registration-invite",
      payload: { inviteId: state.invites[0].id },
      dedupeKey: `registration-invite:${state.invites[0].id}`,
    });
    expect(JSON.stringify(mocks.enqueueOutboxJob.mock.calls)).not.toContain(
      token,
    );
  });

  it("replaces an unused invite for the same email", async () => {
    const first = await (await create({ email: "new@example.com" })).json();
    const second = await (await create({ email: "new@example.com" })).json();
    expect(state.invites).toHaveLength(1);
    expect(state.invites[0].tokenHash).toBe(
      hashRegistrationInvite(tokenFrom(second.inviteUrl)),
    );
    expect(tokenFrom(first.inviteUrl)).not.toBe(tokenFrom(second.inviteUrl));
  });

  it("refuses an email that already has an account", async () => {
    const response = await create({ email: OTHER.email.toUpperCase() });
    expect(response.status).toBe(409);
    expect(state.invites).toHaveLength(0);
  });

  it("validates the body", async () => {
    expect((await create({ email: "not-an-email" })).status).toBe(400);
    expect(
      (await create({ email: "a@example.com", expiresInDays: 365 })).status,
    ).toBe(400);
    expect(
      (await create({ email: "a@example.com", role: "admin" })).status,
    ).toBe(400);
    expect(state.invites).toHaveLength(0);
  });

  it("lists invites with their status and never their token", async () => {
    await create({ email: "new@example.com" });
    const response = await list();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.registrationMode).toBe("invite");
    expect(body.mailConfigured).toBe(false);
    expect(body.invites).toHaveLength(1);
    expect(body.invites[0]).toMatchObject({
      email: "new@example.com",
      status: "pending",
    });
    expect(body.invites[0]).not.toHaveProperty("tokenHash");
    expect(body.invites[0]).not.toHaveProperty("deliverySecret");
  });
});

describe("cancelling an invite", () => {
  it("removes an unused invite so its link stops working", async () => {
    const body = await (await create({ email: "new@example.com" })).json();
    const response = await revoke(body.invite.id);
    expect(response.status).toBe(200);
    expect(state.invites).toHaveLength(0);

    await expect(
      prepareRegistrationAdmission(prisma, {
        mode: "invite",
        email: "new@example.com",
        inviteToken: tokenFrom(body.inviteUrl),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("answers 404 for an unknown, malformed or used invite", async () => {
    expect((await revoke("cunknown0000000000000000")).status).toBe(404);
    expect((await revoke("not a cuid")).status).toBe(404);

    const body = await (await create({ email: "new@example.com" })).json();
    state.invites[0].usedAt = new Date();
    expect((await revoke(body.invite.id)).status).toBe(404);
    expect(state.invites).toHaveLength(1);
  });
});

describe("signing up with a created invite", () => {
  it("is admitted once, for the invited email only", async () => {
    state.mailProvider = "smtp";
    const body = await (await create({ email: "new@example.com" })).json();
    const inviteToken = tokenFrom(body.inviteUrl);

    await expect(
      prepareRegistrationAdmission(prisma, {
        mode: "invite",
        email: "someone-else@example.com",
        inviteToken,
      }),
    ).rejects.toMatchObject({ status: 403 });

    const admission = await prepareRegistrationAdmission(prisma, {
      mode: "invite",
      email: "NEW@example.com",
      inviteToken,
    });
    await consumeRegistrationAdmission(prisma, admission);
    expect(state.invites[0].usedAt).toBeInstanceOf(Date);
    // A used invite keeps no copy of its link.
    expect(state.invites[0].deliverySecret).toBeNull();

    await expect(
      prepareRegistrationAdmission(prisma, {
        mode: "invite",
        email: "new@example.com",
        inviteToken,
      }),
    ).rejects.toMatchObject({ status: 403 });
    const listed = await (await list()).json();
    expect(listed.invites[0].status).toBe("used");
  });
});
