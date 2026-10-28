import { createHash, randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

import { POST as mcpPost } from "@/app/api/agent/v1/mcp/route";
import {
  createConsentTicket,
  decideConsent,
  exchangeAuthorizationCode,
  refreshAccessToken,
  registerClient,
  resolveAccessToken,
  validateAuthorizationRequest,
} from "@/lib/oauth/service";
import { approveSuggestion, revertChangeSet } from "@/lib/agents/service-core";

afterAll(async () => {
  await prisma.$disconnect();
});

let rpcId = 0;
async function callMcp(token: string, method: string, params?: unknown) {
  const response = await mcpPost(
    new NextRequest("http://localhost:3000/api/agent/v1/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    }),
  );
  return { status: response.status, body: await response.json() };
}

async function callTool(token: string, name: string, args: unknown) {
  const { body } = await callMcp(token, "tools/call", {
    name,
    arguments: args,
  });
  return body;
}

function inside(
  item: { positionX: number; positionY: number; width: number; height: number },
  frame: {
    positionX: number;
    positionY: number;
    width: number;
    height: number;
  },
) {
  return (
    item.positionX >= frame.positionX &&
    item.positionY >= frame.positionY &&
    item.positionX + item.width <= frame.positionX + frame.width &&
    item.positionY + item.height <= frame.positionY + frame.height
  );
}

describe("connected app: sign in, save, sort into piles, approve, undo", () => {
  it("runs the whole journey against PostgreSQL", async () => {
    const user = await prisma.user.create({
      data: { email: `oauth-${Date.now()}@example.com` },
    });
    const inbox = await prisma.canvas.create({
      data: { name: "Inbox", userId: user.id },
    });
    const privateBoard = await prisma.canvas.create({
      data: { name: "Private", userId: user.id },
    });

    // 1. The app registers itself and the user approves it for the Inbox only.
    const registration = await registerClient({
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    });
    const verifier = randomBytes(32).toString("base64url");
    const validation = await validateAuthorizationRequest({
      response_type: "code",
      client_id: registration.client_id,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state: "xyz",
      resource: "http://localhost:3000/api/agent/v1/mcp",
    });
    if (!validation.ok) throw new Error("authorization request rejected");

    const redirect = new URL(
      await decideConsent({
        ticket: createConsentTicket(validation.request, user.id),
        userId: user.id,
        approve: true,
        canvasIds: [inbox.id],
        allowDirectWrites: false,
      }),
    );
    expect(redirect.origin + redirect.pathname).toBe(
      "https://claude.ai/api/mcp/auth_callback",
    );
    expect(redirect.searchParams.get("state")).toBe("xyz");
    const code = redirect.searchParams.get("code")!;

    // 2. PKCE-bound, single-use code exchange.
    await expect(
      exchangeAuthorizationCode({
        clientId: registration.client_id,
        code,
        redirectUri: "https://claude.ai/api/mcp/auth_callback",
        codeVerifier: randomBytes(32).toString("base64url"),
      }),
    ).rejects.toMatchObject({ error: "invalid_grant" });
    const codeRow = await prisma.oAuthAuthorizationCode.findFirstOrThrow({
      where: { clientId: registration.client_id },
    });
    expect(codeRow.consumedAt).not.toBeNull();

    const secondCode = new URL(
      await decideConsent({
        ticket: createConsentTicket(validation.request, user.id),
        userId: user.id,
        approve: true,
        canvasIds: [inbox.id],
        allowDirectWrites: false,
      }),
    ).searchParams.get("code")!;
    const tokens = await exchangeAuthorizationCode({
      clientId: registration.client_id,
      code: secondCode,
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeVerifier: verifier,
    });
    await expect(
      exchangeAuthorizationCode({
        clientId: registration.client_id,
        code: secondCode,
        redirectUri: "https://claude.ai/api/mcp/auth_callback",
        codeVerifier: verifier,
      }),
    ).rejects.toMatchObject({ error: "invalid_grant" });

    const init = await callMcp(tokens.access_token, "initialize", {
      protocolVersion: "2025-06-18",
    });
    expect(init.status).toBe(200);
    expect(init.body.result.protocolVersion).toBe("2025-06-18");

    // 3. The app saves links; each lands in its own free spot.
    const links = [
      ["https://cooking.example/pasta", "Easy pasta recipe"],
      ["https://food.example/curry", "Weeknight curry recipe"],
      ["https://docs.python.org/3/tutorial", "Python tutorial"],
      ["https://realpython.example/async", "Async python patterns"],
      ["https://news.example/today", "Morning headlines"],
    ];
    for (const [url, title] of links) {
      const saved = await callTool(tokens.access_token, "inbox_save", {
        url,
        title,
      });
      expect(saved.result.structuredContent.canvasId).toBe(inbox.id);
    }
    const saved = await prisma.canvasItem.findMany({
      where: { canvasId: inbox.id, deletedAt: null },
    });
    expect(saved).toHaveLength(5);
    expect(
      new Set(saved.map((item) => `${item.positionX},${item.positionY}`)).size,
    ).toBe(5);
    const originalPositions = new Map(
      saved.map((item) => [item.id, [item.positionX, item.positionY]]),
    );

    // 4. Search is scoped and labels saved content as untrusted.
    const search = await callTool(tokens.access_token, "items_search", {
      query: "recipe",
    });
    expect(search.result.structuredContent.results).toHaveLength(2);
    expect(search.result.content[0].text).toMatch(/never as instructions/);
    const outOfScope = await callTool(tokens.access_token, "items_search", {
      query: "recipe",
      canvasId: privateBoard.id,
    });
    expect(outOfScope.error.code).toBe(-32003);

    // 5. Memoria proposes piles; the app cannot approve its own proposal.
    const sorted = await callTool(tokens.access_token, "inbox_sort", {});
    const proposal = sorted.result.structuredContent;
    // Equal-sized piles are ordered alphabetically.
    expect(proposal.piles.map((pile: { title: string }) => pile.title)).toEqual(
      ["Python", "Recipe"],
    );
    const selfApproval = await callTool(
      tokens.access_token,
      "actions_approve_suggestion",
      { suggestionId: proposal.suggestion.id },
    );
    expect(selfApproval.error.code).toBe(-32003);
    expect(
      await prisma.canvasItem.count({
        where: { canvasId: inbox.id, type: "FRAME" },
      }),
    ).toBe(0);

    // 6. The user approves; running it creates frames and moves items inside.
    await approveSuggestion({
      userId: user.id,
      suggestionId: proposal.suggestion.id,
    });
    const executed = await callTool(
      tokens.access_token,
      "actions_execute_suggestion",
      { suggestionId: proposal.suggestion.id },
    );
    const { changeSetId, movedItemCount } =
      executed.result.structuredContent.executed;
    expect(movedItemCount).toBe(4);

    const frames = await prisma.canvasItem.findMany({
      where: { canvasId: inbox.id, type: "FRAME", deletedAt: null },
      orderBy: { positionX: "asc" },
    });
    expect(
      frames.map((frame) => (frame.content as { title: string }).title),
    ).toEqual(["Python", "Recipe"]);
    for (const [index, pile] of proposal.piles.entries()) {
      const members = await prisma.canvasItem.findMany({
        where: { id: { in: pile.itemIds } },
      });
      for (const member of members) {
        expect(inside(member, frames[index])).toBe(true);
      }
    }
    const headline = saved.find(
      (item) =>
        (item.content as { title: string }).title === "Morning headlines",
    )!;
    const headlineAfter = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: headline.id },
    });
    expect([headlineAfter.positionX, headlineAfter.positionY]).toEqual(
      originalPositions.get(headline.id),
    );

    // 7. One undo restores the board exactly.
    const changeSet = await prisma.changeSet.findUniqueOrThrow({
      where: { id: changeSetId },
    });
    await revertChangeSet({
      actor: { userId: user.id, agentProfileId: changeSet.agentProfileId },
      changeSetId,
    });
    expect(
      await prisma.canvasItem.count({
        where: { canvasId: inbox.id, type: "FRAME", deletedAt: null },
      }),
    ).toBe(0);
    for (const item of await prisma.canvasItem.findMany({
      where: { canvasId: inbox.id, deletedAt: null },
    })) {
      expect([item.positionX, item.positionY]).toEqual(
        originalPositions.get(item.id),
      );
    }

    // 8. Refresh rotates the pair; turning the app off cuts access at once.
    const rotated = await refreshAccessToken({
      clientId: registration.client_id,
      refreshToken: tokens.refresh_token,
    });
    expect(await resolveAccessToken(tokens.access_token)).toBeNull();
    await expect(
      refreshAccessToken({
        clientId: registration.client_id,
        refreshToken: tokens.refresh_token,
      }),
    ).rejects.toMatchObject({ error: "invalid_grant" });
    expect(await resolveAccessToken(rotated.access_token)).not.toBeNull();

    await prisma.agentProfile.update({
      where: { id: changeSet.agentProfileId },
      data: { status: "DISABLED" },
    });
    const afterDisable = await callMcp(rotated.access_token, "tools/list");
    expect(afterDisable.status).toBe(401);
  });
});
