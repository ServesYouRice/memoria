import { describe, expect, it } from "vitest";
import {
  canBroadcastSocial,
  isAllowedCollaborationOrigin,
  isValidGuestShare,
  parseCollaborationMessage,
} from "@/lib/collaboration/websocket-server";

describe("collaboration origin admission", () => {
  it("requires an exact configured origin", () => {
    expect(
      isAllowedCollaborationOrigin(
        "https://memoria.example",
        "https://memoria.example/app",
      ),
    ).toBe(true);
    expect(
      isAllowedCollaborationOrigin(
        "https://attacker.example",
        "https://memoria.example",
      ),
    ).toBe(false);
    expect(
      isAllowedCollaborationOrigin(undefined, "https://memoria.example"),
    ).toBe(false);
  });
});

describe("collaboration capabilities and schemas", () => {
  it("requires the active public token for guests", () => {
    const canvas = { isPublic: true, shareToken: "active" };
    expect(isValidGuestShare(canvas, null)).toBe(false);
    expect(isValidGuestShare(canvas, "revoked")).toBe(false);
    expect(isValidGuestShare(canvas, "active")).toBe(true);
  });

  it("keeps VIEW read-only for chat and reactions", () => {
    expect(canBroadcastSocial("VIEW")).toBe(false);
    expect(canBroadcastSocial("COMMENT")).toBe(true);
    expect(canBroadcastSocial("EDIT")).toBe(true);
    expect(canBroadcastSocial("OWNER")).toBe(true);
  });

  it("rejects arbitrary message records", () => {
    expect(
      parseCollaborationMessage({
        type: "message",
        payload: { arbitrary: "record" },
      }).success,
    ).toBe(false);
    expect(
      parseCollaborationMessage({
        type: "message",
        payload: {
          kind: "cursor_chat",
          message: "hello",
          position: { x: 1, y: 2 },
        },
      }).success,
    ).toBe(true);
  });
});
