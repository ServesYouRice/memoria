/**
 * Built-in canvas templates (IMP-098). Each is a small plan of items, written
 * through the same checked path as an opened canvas file (IMP-096), so a
 * template can never hold content an ordinary save would refuse.
 */

import { ItemType } from "@/types/canvas";
import type { NoteColorName } from "@/lib/note-colors";
import {
  plainTextToNoteHtml,
  type ImportPlan,
  type PlannedItem,
} from "@/lib/canvas-formats/types";

export type TemplateCategory =
  "planning" | "thinking" | "meetings" | "personal" | "research";

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  planning: "Planning",
  thinking: "Thinking",
  meetings: "Meetings",
  personal: "Personal",
  research: "Research",
};

export interface BuiltInTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  items: PlannedItem[];
}

/** A box in a template's small preview. */
export interface TemplatePreviewBox {
  type: "note" | "frame" | "text" | "shape" | "arrow";
  x: number;
  y: number;
  width: number;
  height: number;
  color?: NoteColorName;
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  itemCount: number;
  preview: TemplatePreviewBox[];
}

const NOTE_W = 200;
const NOTE_H = 140;

function note(
  key: string,
  x: number,
  y: number,
  text: string,
  color: NoteColorName = "yellow",
  width = NOTE_W,
  height = NOTE_H,
): PlannedItem {
  return {
    key,
    type: ItemType.NOTE,
    positionX: x,
    positionY: y,
    width,
    height,
    content: { text: plainTextToNoteHtml(text), color },
  };
}

function frame(
  key: string,
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
): PlannedItem {
  return {
    key,
    type: ItemType.FRAME,
    positionX: x,
    positionY: y,
    width,
    height,
    content: { title },
  };
}

function heading(key: string, x: number, y: number, text: string, width = 600) {
  return {
    key,
    type: ItemType.TEXT,
    positionX: x,
    positionY: y,
    width,
    height: 48,
    content: { text, fontSize: 32 },
  } satisfies PlannedItem;
}

function arrow(key: string, from: string, to: string, label?: string) {
  return {
    key,
    type: ItemType.ARROW,
    positionX: 0,
    positionY: 0,
    width: 1,
    height: 1,
    startKey: from,
    endKey: to,
    content: {
      arrowHeadStart: "none",
      arrowHeadEnd: "arrow",
      strokeWidth: 2,
      ...(label ? { label } : {}),
    },
  } satisfies PlannedItem;
}

function box(key: string, x: number, y: number, width: number, height: number) {
  return {
    key,
    type: ItemType.SHAPE,
    positionX: x,
    positionY: y,
    width,
    height,
    content: { shapeType: "rectangle", strokeWidth: 2 },
  } satisfies PlannedItem;
}

/** Columns of frames with starter notes, e.g. To do / Doing / Done. */
function columns(
  titles: string[],
  notes: Array<Array<[string, NoteColorName?]>>,
  top = 80,
): PlannedItem[] {
  const width = 260;
  const items: PlannedItem[] = [];
  titles.forEach((title, column) => {
    const x = column * (width + 40);
    items.push(frame(`col${column}`, x, top, width, 520, title));
    (notes[column] ?? []).forEach(([text, color], row) => {
      items.push(
        note(`col${column}n${row}`, x + 30, top + 50 + row * 160, text, color),
      );
    });
  });
  return items;
}

/** A centre note with ideas around it, joined by arrows. */
function radial(
  centre: string,
  ideas: string[],
  colors: NoteColorName[],
): PlannedItem[] {
  const items: PlannedItem[] = [
    note("centre", 0, 0, centre, "orange", 240, 160),
  ];
  ideas.forEach((idea, index) => {
    const angle = (index / ideas.length) * Math.PI * 2 - Math.PI / 2;
    const x = Math.round(Math.cos(angle) * 420 + 20);
    const y = Math.round(Math.sin(angle) * 300 + 10);
    items.push(note(`idea${index}`, x, y, idea, colors[index % colors.length]));
  });
  ideas.forEach((_, index) =>
    items.push(arrow(`link${index}`, "centre", `idea${index}`)),
  );
  return items;
}

export const BUILT_IN_TEMPLATES: readonly BuiltInTemplate[] = [
  {
    id: "todo-list",
    name: "To-do list",
    description: "Three columns: to do, doing and done.",
    category: "planning",
    items: [
      heading("title", 0, 0, "To-do list"),
      ...columns(
        ["To do", "Doing", "Done"],
        [
          [["First task"], ["Second task"]],
          [["In progress", "blue"]],
          [["Finished", "green"]],
        ],
      ),
    ],
  },
  {
    id: "weekly-planner",
    name: "Weekly planner",
    description: "A note for each day and one for the week's goals.",
    category: "planning",
    items: [
      heading("title", 0, 0, "This week"),
      ...[
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ].map((day, index) =>
        note(
          `day${index}`,
          (index % 4) * 230,
          80 + Math.floor(index / 4) * 180,
          `${day}\n`,
          index >= 5 ? "green" : "yellow",
        ),
      ),
      note("goals", 3 * 230, 260, "Goals for the week\n", "pink"),
    ],
  },
  {
    id: "project-timeline",
    name: "Project timeline",
    description: "Steps from start to finish, joined in order.",
    category: "planning",
    items: [
      heading("title", 0, 0, "Project timeline"),
      ...["Start", "Plan", "Build", "Check", "Finish"].map((step, index) =>
        note(
          `step${index}`,
          index * 260,
          100,
          `${step}\nWhat happens here?`,
          index === 0 ? "green" : index === 4 ? "purple" : "blue",
        ),
      ),
      ...[0, 1, 2, 3].map((index) =>
        arrow(`next${index}`, `step${index}`, `step${index + 1}`),
      ),
    ],
  },
  {
    id: "brainstorm",
    name: "Brainstorm",
    description: "One idea in the middle, six around it.",
    category: "thinking",
    items: radial(
      "Main idea",
      ["Idea", "Idea", "Idea", "Idea", "Idea", "Idea"],
      ["yellow", "pink", "blue", "green", "purple", "yellow"],
    ),
  },
  {
    id: "mind-map",
    name: "Mind map",
    description: "A topic with four branches to grow.",
    category: "thinking",
    items: radial(
      "Topic",
      ["Why?", "Who?", "How?", "What next?"],
      ["blue", "green", "pink", "purple"],
    ),
  },
  {
    id: "pros-and-cons",
    name: "Pros and cons",
    description: "Weigh a choice, then write the decision.",
    category: "thinking",
    items: [
      heading("title", 0, 0, "Should we…?"),
      ...columns(
        ["Pros", "Cons"],
        [[["A good reason", "green"]], [["A worry", "pink"]]],
      ),
      note("decision", 640, 80, "Decision\n", "purple", 240, 180),
    ],
  },
  {
    id: "swot",
    name: "Strengths and weaknesses",
    description:
      "Strengths, weaknesses, opportunities and threats in four boxes.",
    category: "thinking",
    items: [
      heading("title", 0, 0, "Where we stand"),
      frame("s", 0, 80, 400, 300, "Strengths"),
      frame("w", 440, 80, 400, 300, "Weaknesses"),
      frame("o", 0, 420, 400, 300, "Opportunities"),
      frame("t", 440, 420, 400, 300, "Threats"),
      note("sn", 30, 130, "We are good at…", "green"),
      note("wn", 470, 130, "We struggle with…", "pink"),
      note("on", 30, 470, "We could…", "blue"),
      note("tn", 470, 470, "Watch out for…", "orange"),
    ],
  },
  {
    id: "meeting-notes",
    name: "Meeting notes",
    description: "Agenda, notes, decisions and who does what.",
    category: "meetings",
    items: [
      heading("title", 0, 0, "Meeting — date"),
      note("agenda", 0, 80, "Agenda\n1.\n2.\n3.", "yellow", 240, 200),
      note("notes", 270, 80, "Notes\n", "blue", 240, 200),
      note("decisions", 540, 80, "Decisions\n", "purple", 240, 200),
      note("actions", 810, 80, "Actions\nWho — what — when", "green", 240, 200),
    ],
  },
  {
    id: "retrospective",
    name: "Look back",
    description: "What went well, what to change, and what to try next.",
    category: "meetings",
    items: [
      heading("title", 0, 0, "Looking back"),
      ...columns(
        ["Went well", "To change", "To try next"],
        [
          [["Add a note", "green"]],
          [["Add a note", "pink"]],
          [["Add a note", "blue"]],
        ],
      ),
    ],
  },
  {
    id: "reading-list",
    name: "Reading list",
    description: "Things to read, being read, and finished.",
    category: "personal",
    items: [
      heading("title", 0, 0, "Reading list"),
      ...columns(
        ["Want to read", "Reading", "Finished"],
        [[["Title — author"]], [["Title — author", "blue"]], []],
      ),
    ],
  },
  {
    id: "trip-planner",
    name: "Trip planner",
    description: "Places, bookings, packing and budget in one place.",
    category: "personal",
    items: [
      heading("title", 0, 0, "Trip to…"),
      frame("places", 0, 80, 420, 320, "Places to see"),
      frame("bookings", 460, 80, 420, 320, "Bookings"),
      note("packing", 0, 440, "Packing list\n- \n- \n- ", "green", 240, 200),
      note("budget", 270, 440, "Budget\n", "orange", 240, 200),
      note("place1", 30, 130, "Place", "pink"),
      note("booking1", 490, 130, "Flight / hotel", "blue"),
    ],
  },
  {
    id: "daily-journal",
    name: "Daily journal",
    description: "Today's focus, what you are thankful for, and notes.",
    category: "personal",
    items: [
      heading("title", 0, 0, "Today"),
      note("focus", 0, 80, "Today's focus\n", "orange", 260, 180),
      note("thanks", 290, 80, "Thankful for\n", "pink", 260, 180),
      note("notes", 580, 80, "Notes\n", "yellow", 260, 180),
    ],
  },
  {
    id: "inspiration",
    name: "Inspiration",
    description: "Spaces for pictures, colours and words.",
    category: "personal",
    items: [
      heading("title", 0, 0, "Inspiration"),
      box("pic1", 0, 80, 280, 200),
      box("pic2", 300, 80, 200, 200),
      box("pic3", 520, 80, 280, 200),
      note("colours", 0, 300, "Colours", "purple"),
      note("words", 220, 300, "Words", "blue"),
      note("feel", 440, 300, "How it should feel", "pink"),
    ],
  },
  {
    id: "research",
    name: "Research",
    description: "A question, sources, findings and what is still open.",
    category: "research",
    items: [
      heading("title", 0, 0, "Research"),
      note("question", 0, 80, "The question\n", "orange", 240, 160),
      frame("sources", 300, 60, 420, 300, "Sources"),
      note("source1", 330, 110, "Paste links here", "blue"),
      note("findings", 780, 80, "Findings\n", "green", 240, 200),
      note("open", 780, 320, "Still open\n", "pink", 240, 160),
      arrow("q-f", "question", "findings", "answers"),
    ],
  },
];

const PREVIEW_TYPE: Partial<Record<ItemType, TemplatePreviewBox["type"]>> = {
  [ItemType.NOTE]: "note",
  [ItemType.FRAME]: "frame",
  [ItemType.TEXT]: "text",
  [ItemType.SHAPE]: "shape",
};

export function findBuiltInTemplate(id: string) {
  return BUILT_IN_TEMPLATES.find((template) => template.id === id) ?? null;
}

/** A template as the gallery shows it: name, words and a tiny preview. */
export function summarizeTemplate(template: BuiltInTemplate): TemplateSummary {
  const preview: TemplatePreviewBox[] = [];
  for (const item of template.items) {
    const type = PREVIEW_TYPE[item.type];
    if (!type) continue;
    const color = item.content.color;
    preview.push({
      type,
      x: item.positionX,
      y: item.positionY,
      width: item.width,
      height: item.height,
      ...(typeof color === "string" ? { color: color as NoteColorName } : {}),
    });
  }
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    itemCount: template.items.length,
    preview,
  };
}

export function templatePlan(template: BuiltInTemplate): ImportPlan {
  return { items: template.items, brought: {}, leftOut: {} };
}
