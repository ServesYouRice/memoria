import type { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import { normalizeNoteContent } from "../src/lib/rich-text/note-format";

let migrated = 0;
for (;;) {
  const notes = await prisma.canvasItem.findMany({
    where: {
      type: "NOTE",
      NOT: { content: { path: ["formatVersion"], equals: 1 } },
    },
    select: { id: true, content: true },
    take: 100,
  });
  if (!notes.length) break;
  for (const note of notes) {
    const content = normalizeNoteContent(note.content);
    await prisma.canvasItem.update({
      where: { id: note.id },
      data: { content: content as unknown as Prisma.InputJsonValue },
    });
    migrated += 1;
  }
}
console.warn(`Migrated ${migrated} note(s) to rich-text format version 1.`);
await prisma.$disconnect();
