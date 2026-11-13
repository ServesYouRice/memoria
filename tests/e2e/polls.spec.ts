/**
 * IMP-104: a vote on one screen shows on every open screen of the canvas
 * within about a second, and the owner can close the poll.
 */
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createCanvas, registerAndVerify, uniqueEmail } from "./helpers";

/** Every Konva Text on the board, as drawn. */
function drawnTexts(page: Page) {
  return page.evaluate(() => {
    const konva = (
      window as unknown as {
        Konva?: { stages?: Array<{ find: (s: string) => unknown[] }> };
      }
    ).Konva;
    return (konva?.stages ?? []).flatMap((stage) =>
      (stage.find("Text") as Array<{ text: () => string }>).map((node) =>
        node.text(),
      ),
    );
  });
}

/** Clicks the drawn Text whose words are exactly `text`. */
async function clickDrawn(page: Page, text: string) {
  const point = await page.evaluate((wanted) => {
    const konva = (
      window as unknown as {
        Konva?: {
          stages?: Array<{
            find: (s: string) => Array<{
              text: () => string;
              getClientRect: () => {
                x: number;
                y: number;
                width: number;
                height: number;
              };
              getStage: () => { container: () => HTMLElement };
            }>;
          }>;
        };
      }
    ).Konva;
    for (const stage of konva?.stages ?? []) {
      for (const node of stage.find("Text")) {
        if (node.text() !== wanted) continue;
        const rect = node.getClientRect();
        const box = node.getStage().container().getBoundingClientRect();
        return {
          x: box.left + rect.x + rect.width / 2,
          y: box.top + rect.y + rect.height / 2,
        };
      }
    }
    return null;
  }, text);
  expect(point, `"${text}" is drawn`).not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
}

test("a vote shows on every open screen and the owner closes the poll", async ({
  page,
  context,
}) => {
  await registerAndVerify(page, uniqueEmail("poll"));
  const canvas = await createCanvas(page, "Team lunch");
  const created = await page.request.post("/api/v1/canvas-items", {
    data: {
      canvasId: canvas.id,
      type: "POLL",
      positionX: 120,
      positionY: 120,
      width: 320,
      height: 220,
      zIndex: 1,
      content: {
        question: "Lunch?",
        options: [
          { id: "pizza", text: "Pizza" },
          { id: "sushi", text: "Sushi" },
        ],
      },
      tags: [],
    },
    headers: { "x-idempotency-key": randomUUID() },
  });
  expect(created.status()).toBe(201);

  const other = await context.newPage();
  for (const screen of [page, other]) {
    await screen.goto(`/canvas/${canvas.id}`);
    await expect
      .poll(() => drawnTexts(screen), { timeout: 30_000 })
      .toContain("0 people voted • Pick one");
  }

  await clickDrawn(page, "Pizza");
  await expect.poll(() => drawnTexts(page)).toContain("✓ Pizza");
  // The other screen catches up within about a second.
  await expect
    .poll(() => drawnTexts(other), { timeout: 2_000, intervals: [100] })
    .toContain("1 person voted • Pick one");
  expect(await drawnTexts(other)).toContain("1 · 100%");

  await clickDrawn(page, "Close poll");
  await expect
    .poll(() => drawnTexts(other), { timeout: 2_000, intervals: [100] })
    .toContain("1 person voted • Pick one • Closed");

  // A closed poll takes no more votes, whatever the browser sends.
  const items = await page.request.get(
    `/api/v1/canvas-items?canvasId=${canvas.id}&type=POLL`,
  );
  const pollId = ((await items.json()) as { items: Array<{ id: string }> })
    .items[0]!.id;
  const late = await page.request.put(`/api/v1/canvas-items/${pollId}/poll`, {
    data: { choiceIds: ["sushi"] },
  });
  expect(late.status()).toBe(409);
});
