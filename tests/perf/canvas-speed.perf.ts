/**
 * IMP-103 — the canvas stays smooth when it is full. Opens a seeded canvas
 * of 2,000 mixed items in a real browser against the production image and
 * measures opening time and frame times while panning, zooming and dragging
 * a note. Run with `pnpm gate perf` (opt-in; not part of the fast gate).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { registerAndVerify, uniqueEmail } from "../e2e/helpers";
import {
  CANVAS_SPEED_BUDGETS,
  FULL_CANVAS_ITEMS,
  LONG_FRAME_MS,
} from "./budgets";
import { FIRST_NOTE, fullCanvasFile } from "./full-canvas";

interface FrameStats {
  frames: number;
  p50FrameMs: number;
  p95FrameMs: number;
  maxFrameMs: number;
  longFrameShare: number;
}

function stats(gaps: number[]): FrameStats {
  const sorted = [...gaps].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
      : 0;
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    frames: gaps.length,
    p50FrameMs: round(at(0.5)),
    p95FrameMs: round(at(0.95)),
    maxFrameMs: round(sorted.at(-1) ?? 0),
    longFrameShare: gaps.length
      ? round(
          (gaps.filter((gap) => gap > LONG_FRAME_MS).length / gaps.length) *
            100,
        ) / 100
      : 0,
  };
}

/** Records the gap between animation frames while `action` runs. */
async function measureFrames(page: Page, action: () => Promise<void>) {
  await page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __recording: boolean };
    w.__gaps = [];
    w.__recording = true;
    let last = performance.now();
    const tick = (now: number) => {
      w.__gaps.push(now - last);
      last = now;
      if (w.__recording) requestAnimationFrame(tick);
    };
    requestAnimationFrame((now) => {
      last = now;
      requestAnimationFrame(tick);
    });
  });
  await action();
  const gaps = await page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __recording: boolean };
    w.__recording = false;
    return w.__gaps;
  });
  return stats(gaps);
}

/** World-to-screen for the Konva stage (Konva puts itself on window). */
async function stageInfo(page: Page) {
  return page.evaluate(() => {
    const stage = (
      window as unknown as { __boardStage: () => any }
    ).__boardStage();
    if (!stage) return null;
    // The drawing surface itself; the outer container can measure 0.
    const rect = (stage.content as HTMLElement).getBoundingClientRect();
    const layer = stage.getLayers().at(-1);
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      x: stage.x(),
      y: stage.y(),
      scale: stage.scaleX(),
      drawnItems: layer ? layer.getChildren().length : 0,
    };
  });
}

test("a full canvas opens fast and moves smoothly (IMP-103)", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  // The board is the largest drawn Konva stage; others (previews,
  // thumbnails) may exist too.
  await page.addInitScript(() => {
    (window as unknown as { __boardStage: () => unknown }).__boardStage =
      () => {
        const stages: any[] =
          (window as unknown as { Konva?: { stages?: any[] } }).Konva?.stages ??
          [];
        let best: any = null;
        let bestArea = 0;
        for (const stage of stages) {
          const rect = (stage.content as HTMLElement).getBoundingClientRect();
          const area = rect.width * rect.height;
          if (area > bestArea) {
            best = stage;
            bestArea = area;
          }
        }
        return best;
      };
  });
  await registerAndVerify(page, uniqueEmail("canvas-speed"));

  const imported = await page.request.post("/api/v1/canvases/import", {
    multipart: {
      name: "Full canvas",
      file: {
        name: "full.canvas",
        mimeType: "application/json",
        buffer: Buffer.from(fullCanvasFile()),
      },
    },
    headers: { "x-idempotency-key": randomUUID() },
    timeout: 120_000,
  });
  expect(imported.status()).toBe(201);
  const result = (await imported.json()) as {
    canvasId: string;
    itemCount: number;
  };
  expect(result.itemCount).toBe(FULL_CANVAS_ITEMS);

  // Opening: from navigation start until the first notes are drawn.
  await page.goto(`/canvas/${result.canvasId}`);
  await page.waitForFunction(
    () => {
      const stage = (
        window as unknown as { __boardStage: () => any }
      ).__boardStage();
      const layer = stage?.getLayers().at(-1);
      return layer && layer.getChildren().length >= 50;
    },
    undefined,
    { polling: "raf", timeout: 60_000 },
  );
  const openMs = Math.round(await page.evaluate(() => performance.now()));
  const opened = await stageInfo(page);
  expect(opened).not.toBeNull();

  // Motion is measured on a settled board: the live document has connected
  // and its first sync has been applied (a one-off cost of opening).
  await expect(page.getByText("Live", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const deadline = performance.now() + 20_000;
        let last = performance.now();
        let calm = 0;
        const tick = (now: number) => {
          calm = now - last < 34 ? calm + 1 : 0;
          last = now;
          if (calm >= 60) resolve();
          else if (now > deadline) reject(new Error("board never settled"));
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  const center = {
    x: opened!.left + opened!.width / 2,
    y: opened!.top + opened!.height / 2,
  };
  // Pan from the gap between two notes: pressing on a note would move it.
  const gap = {
    x: opened!.left + opened!.x + 260 * opened!.scale,
    y: opened!.top + opened!.y + 160 * opened!.scale,
  };

  // Pan: hold Space and drag across the canvas.
  const pan = await measureFrames(page, async () => {
    await page.mouse.move(gap.x, gap.y);
    await page.keyboard.down("Space");
    await page.mouse.down();
    for (let step = 1; step <= 60; step += 1) {
      await page.mouse.move(gap.x + step * 12, gap.y + step * 6);
    }
    await page.mouse.up();
    await page.keyboard.up("Space");
  });
  const afterPan = await stageInfo(page);
  expect(afterPan!.x).not.toBe(opened!.x);

  // Zoom: wheel out and back in around the middle.
  const zoom = await measureFrames(page, async () => {
    await page.mouse.move(center.x, center.y);
    for (let step = 0; step < 30; step += 1) {
      await page.mouse.wheel(0, step < 15 ? 100 : -100);
    }
  });

  // Drag the first note wherever it now sits on screen.
  const home = await stageInfo(page);
  const noteAt = {
    x:
      home!.left +
      home!.x +
      (FIRST_NOTE.x + FIRST_NOTE.width / 2) * home!.scale,
    y: home!.top + home!.y + (FIRST_NOTE.y + 30) * home!.scale,
  };
  const firstNoteAt = () =>
    page.evaluate(() => {
      const stage = (
        window as unknown as { __boardStage: () => any }
      ).__boardStage();
      const text = stage?.findOne(
        (node: any) =>
          node.getClassName() === "Text" && /^Note 0(?!\d)/.test(node.text()),
      );
      const group = text?.getParent();
      return group ? { x: group.x(), y: group.y() } : null;
    });
  const before = await firstNoteAt();
  expect(before, "first note is drawn").not.toBeNull();
  const drag = await measureFrames(page, async () => {
    await page.mouse.move(noteAt.x, noteAt.y);
    await page.mouse.down();
    for (let step = 1; step <= 60; step += 1) {
      await page.mouse.move(noteAt.x + step * 5, noteAt.y + step * 3);
    }
    await page.mouse.up();
  });

  // The drag really moved the note (and was not a selection box).
  await expect
    .poll(async () => (await firstNoteAt())?.x ?? before!.x)
    .toBeGreaterThan(before!.x + 100);

  const results = {
    items: FULL_CANVAS_ITEMS,
    browser: testInfo.project.name,
    openMs,
    drawnItemsAtOpen: opened!.drawnItems,
    pan,
    zoom,
    drag,
    budgets: CANVAS_SPEED_BUDGETS,
  };
  mkdirSync("test-results/perf", { recursive: true });
  writeFileSync(
    `test-results/perf/canvas-speed-${testInfo.project.name}-${Date.now()}.json`,
    `${JSON.stringify(results, null, 2)}\n`,
  );
  process.stdout.write(`IMP-103 canvas speed: ${JSON.stringify(results)}\n`);
  await testInfo.attach("canvas-speed.json", {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });

  expect
    .soft(openMs, "open time")
    .toBeLessThanOrEqual(CANVAS_SPEED_BUDGETS.openMs);
  for (const [name, measured] of [
    ["pan", pan],
    ["zoom", zoom],
    ["drag", drag],
  ] as const) {
    const budget = CANVAS_SPEED_BUDGETS[name];
    expect
      .soft(measured.p95FrameMs, `${name} p95 frame`)
      .toBeLessThanOrEqual(budget.p95FrameMs);
    expect
      .soft(measured.longFrameShare, `${name} long frames`)
      .toBeLessThanOrEqual(budget.longFrameShare);
  }
});
