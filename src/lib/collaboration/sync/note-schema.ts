/**
 * IMP-042 — the TipTap configuration for collaboratively edited note text.
 *
 * The browser editor and the sync server build their ProseMirror schema from
 * this one list, so the rich text a client can produce is exactly the rich
 * text the server's note validator accepts (`note-format.ts`): StarterKit
 * without underline or horizontal rules, and a Link mark with Memoria's
 * attributes. Collaboration brings its own Yjs-aware history, so StarterKit's
 * undo/redo is off.
 *
 * @module lib/collaboration/sync/note-schema
 */

import { getSchema, type AnyExtension } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";

function noteExtensions(options: { history: boolean }): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      ...(options.history ? {} : { undoRedo: false }),
      underline: false,
      horizontalRule: false,
      link: false,
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: {
        target: "_blank",
        rel: "noopener noreferrer",
      },
    }),
  ];
}

export function collaborativeNoteExtensions(): AnyExtension[] {
  return noteExtensions({ history: false });
}

/**
 * The same schema for a note edited alone (no shared fragment), with
 * StarterKit's own undo/redo history.
 */
export function standaloneNoteExtensions(): AnyExtension[] {
  return noteExtensions({ history: true });
}

let schema: Schema | null = null;

export function collaborativeNoteSchema(): Schema {
  schema ??= getSchema(collaborativeNoteExtensions());
  return schema;
}
