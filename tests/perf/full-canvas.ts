/**
 * IMP-103 — a JSON Canvas file with exactly 2,000 mixed items, opened through
 * the normal import (one request) so the seed uses the same write path and
 * limits as a person would: notes, links, groups (frames) and connections
 * (arrows).
 */
import { FULL_CANVAS_ITEMS } from "./budgets";

const COLUMNS = 50;
const SPACING_X = 280;
const SPACING_Y = 180;

export function fullCanvasFile() {
  const groups = 100;
  const edges = 100;
  const links = 300;
  const notes = FULL_CANVAS_ITEMS - groups - edges - links;
  const nodes: Array<Record<string, unknown>> = [];
  const place = (index: number) => ({
    x: (index % COLUMNS) * SPACING_X,
    y: Math.floor(index / COLUMNS) * SPACING_Y,
  });

  let cell = 0;
  for (let index = 0; index < notes; index += 1, cell += 1) {
    nodes.push({
      id: `n${index}`,
      type: "text",
      text: `Note ${index}\nSome words to wrap across a second line, like a real note would.`,
      ...place(cell),
      width: 240,
      height: 140,
      ...(index % 4 === 0 ? { color: String((index % 6) + 1) } : {}),
    });
  }
  for (let index = 0; index < links; index += 1, cell += 1) {
    nodes.push({
      id: `l${index}`,
      type: "link",
      url: `https://example.com/article/${index}`,
      ...place(cell),
      width: 240,
      height: 140,
    });
  }
  // Groups sit around blocks of five cells from row 20 on, so the first
  // note (the drag target) is not inside one.
  for (let index = 0; index < groups; index += 1) {
    const origin = place(20 * COLUMNS + index * 5);
    nodes.push({
      id: `g${index}`,
      type: "group",
      label: `Group ${index}`,
      x: origin.x - 20,
      y: origin.y - 20,
      width: SPACING_X * 5,
      height: SPACING_Y,
    });
  }
  const connections = Array.from({ length: edges }, (_, index) => ({
    id: `e${index}`,
    fromNode: `n${index * 2}`,
    toNode: `n${index * 2 + 1}`,
  }));
  return JSON.stringify({ nodes, edges: connections });
}

/** Where the first note is drawn in world coordinates (it is a drag target). */
export const FIRST_NOTE = { x: 0, y: 0, width: 240, height: 140 };
