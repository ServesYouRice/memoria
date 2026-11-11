/**
 * TASK-165: a signed-in user who is neither the owner nor a share recipient
 * gets VIEW on a public canvas only with its current share token.
 */
import { describe, expect, it } from "vitest";
import { resolveCollaborationAccess } from "@/lib/collaboration/transport-policy";

const publicCanvas = {
  userId: "owner",
  isPublic: true,
  shareToken: "current",
};
const privateCanvas = { userId: "owner", isPublic: false, shareToken: null };

type Row = [
  string,
  Parameters<typeof resolveCollaborationAccess>[0],
  ReturnType<typeof resolveCollaborationAccess>,
];

const rows: Row[] = [
  [
    "owner without token",
    { principalId: "owner", sessionActive: true, canvas: publicCanvas },
    "OWNER",
  ],
  [
    "owner with stale token",
    {
      principalId: "owner",
      sessionActive: true,
      canvas: publicCanvas,
      shareToken: "old",
    },
    "OWNER",
  ],
  [
    "VIEW recipient",
    {
      principalId: "r",
      sessionActive: true,
      canvas: publicCanvas,
      sharedRole: "VIEW",
    },
    "VIEW",
  ],
  [
    "COMMENT recipient",
    {
      principalId: "r",
      sessionActive: true,
      canvas: privateCanvas,
      sharedRole: "COMMENT",
    },
    "COMMENT",
  ],
  [
    "EDIT recipient with stale token",
    {
      principalId: "r",
      sessionActive: true,
      canvas: publicCanvas,
      sharedRole: "EDIT",
      shareToken: "old",
    },
    "EDIT",
  ],
  [
    "guest with current token",
    { principalId: "guest:a", canvas: publicCanvas, shareToken: "current" },
    "VIEW",
  ],
  [
    "guest with stale token",
    { principalId: "guest:a", canvas: publicCanvas, shareToken: "old" },
    null,
  ],
  [
    "signed-in stranger without token",
    { principalId: "s", sessionActive: true, canvas: publicCanvas },
    null,
  ],
  [
    "signed-in stranger with stale token",
    {
      principalId: "s",
      sessionActive: true,
      canvas: publicCanvas,
      shareToken: "old",
    },
    null,
  ],
  [
    "signed-in stranger with current token",
    {
      principalId: "s",
      sessionActive: true,
      canvas: publicCanvas,
      shareToken: "current",
    },
    "VIEW",
  ],
  [
    "signed-in stranger, inactive session",
    {
      principalId: "s",
      sessionActive: false,
      canvas: publicCanvas,
      shareToken: "current",
    },
    null,
  ],
  [
    "signed-in stranger on private canvas",
    {
      principalId: "s",
      sessionActive: true,
      canvas: privateCanvas,
      shareToken: "current",
    },
    null,
  ],
  [
    "null share token never matches",
    {
      principalId: "s",
      sessionActive: true,
      canvas: { ...publicCanvas, shareToken: null },
      shareToken: "",
    },
    null,
  ],
];

describe("resolveCollaborationAccess with public share tokens", () => {
  it.each(rows)("%s", (_name, options, expected) => {
    expect(resolveCollaborationAccess(options)).toBe(expected);
  });
});
