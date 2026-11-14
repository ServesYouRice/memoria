/**
 * IMP-104: poll content carries no votes, the board's answer logic, the live
 * notice, and exports that show the counted result.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/fetch-client", () => ({ apiFetch: fetchMock }));

import { ItemType, type CanvasItem } from "@/types/canvas";
import { pollContentSchema } from "@/lib/validation/canvas-item";
import { isPollChangedMessage } from "@/lib/polls/shared";
import { nextPollChoices } from "@/features/canvas/hooks/use-poll-results";
import { pollFooter, pollHeight } from "@/features/canvas/components/PollItem";
import { exportToJSON, exportToMarkdown } from "@/lib/export/export-utils";

afterEach(() => {
  fetchMock.mockReset();
});

const options = [
  { id: "pizza", text: "Pizza" },
  { id: "sushi", text: "Sushi" },
];

describe("poll content (IMP-104)", () => {
  it("drops any votes list a browser sends with the content", () => {
    const parsed = pollContentSchema.parse({
      question: "Lunch?",
      options: options.map((option) => ({ ...option, votes: ["u1", "u2"] })),
    });
    expect(JSON.stringify(parsed)).not.toContain("votes");
  });

  it("takes 2 to 20 choices with their own ids", () => {
    expect(
      pollContentSchema.safeParse({ question: "Q", options: [options[0]] })
        .success,
    ).toBe(false);
    const many = Array.from({ length: 21 }, (_, i) => ({
      id: `c${i}`,
      text: `Choice ${i}`,
    }));
    expect(
      pollContentSchema.safeParse({ question: "Q", options: many }).success,
    ).toBe(false);
    expect(
      pollContentSchema.safeParse({ question: "Q", options: many.slice(0, 20) })
        .success,
    ).toBe(true);
    expect(
      pollContentSchema.safeParse({
        question: "Q",
        options: [options[0], options[0]],
      }).success,
    ).toBe(false);
  });
});

describe("answering on the board (IMP-104)", () => {
  it("switches a single choice, toggles multiple choices and clears", () => {
    expect(nextPollChoices([], "a", false)).toEqual(["a"]);
    expect(nextPollChoices(["a"], "b", false)).toEqual(["b"]);
    expect(nextPollChoices(["a"], "a", false)).toEqual([]);
    expect(nextPollChoices(["a"], "b", true)).toEqual(["a", "b"]);
    expect(nextPollChoices(["a", "b"], "a", true)).toEqual(["b"]);
  });

  it("says how many voted and whether the poll is closed", () => {
    expect(pollFooter(1, false, false)).toBe("1 person voted • Pick one");
    expect(pollFooter(3, true, true)).toBe(
      "3 people voted • Pick any • Closed",
    );
    expect(pollHeight(3)).toBeGreaterThan(pollHeight(2));
  });

  it("recognises only the poll-changed notice", () => {
    expect(isPollChangedMessage({ type: "poll-changed", itemId: "i1" })).toBe(
      true,
    );
    expect(isPollChangedMessage({ kind: "cursor_chat" })).toBe(false);
    expect(isPollChangedMessage(null)).toBe(false);
  });
});

function poll(): CanvasItem {
  return {
    id: "p1",
    canvasId: "c1",
    type: ItemType.POLL,
    positionX: 0,
    positionY: 0,
    width: 320,
    height: 200,
    zIndex: 1,
    version: 1,
    content: { question: "Lunch?", options },
    tags: [],
    createdAt: "",
    updatedAt: "",
  } as CanvasItem;
}

function answerWith(results: unknown) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ polls: results }), { status: 200 }),
  );
}

describe("exports show the question and the result (IMP-104)", () => {
  const result = {
    itemId: "p1",
    multipleChoice: false,
    closed: true,
    closedAt: "2026-11-12T10:00:00.000Z",
    counts: { pizza: 2, sushi: 1 },
    voters: 3,
    myChoiceIds: ["pizza"],
  };

  it("Markdown lists each choice with its votes", async () => {
    answerWith([result]);
    const md = await exportToMarkdown("c1", "Team", [poll()]);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/canvases/c1/polls");
    expect(md).toContain("## Poll: Lunch?");
    expect(md).toContain("- Pizza: 2 votes");
    expect(md).toContain("- Sushi: 1 vote");
    expect(md).toContain("3 people voted; the poll is closed.");
  });

  it("JSON carries the counted result but not the exporter's own choices", async () => {
    answerWith([result]);
    const data = JSON.parse(await exportToJSON("c1", "Team", [poll()]));
    expect(data.polls).toEqual([
      {
        itemId: "p1",
        question: "Lunch?",
        multipleChoice: false,
        closed: true,
        voters: 3,
        choices: [
          { id: "pizza", text: "Pizza", votes: 2 },
          { id: "sushi", text: "Sushi", votes: 1 },
        ],
      },
    ]);
  });

  it("asks nothing for a canvas without polls", async () => {
    const md = await exportToMarkdown("c1", "Team", []);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(md).not.toContain("Poll");
  });
});
