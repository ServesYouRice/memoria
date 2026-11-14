/**
 * IMP-042 / IMP-142: the shared text of a note, for editing it live.
 *
 * The note dialog and the in-place note editor both edit the same Yjs
 * fragment of the canvas document; nothing else saves the text while the
 * document is open and writable. Type-only imports keep Yjs out of bundles
 * that never open a document.
 */

import type * as Y from "yjs";
import type {
  CanvasDocumentSession,
  CanvasDocumentSnapshot,
} from "@/lib/collaboration/sync/client-session";

/** Notes can be edited (and started) live: the document is open and writable. */
export function liveEditingAvailable(
  session: CanvasDocumentSession | null,
  snapshot: CanvasDocumentSnapshot,
): boolean {
  return Boolean(session?.acceptsWrites && snapshot.writable);
}

/**
 * The note's shared text while the canvas document is open and writable and
 * holds the item; otherwise null (edit through the HTTP form instead).
 */
export function liveNoteFragment(
  session: CanvasDocumentSession | null,
  snapshot: CanvasDocumentSnapshot,
  itemId: string,
): Y.XmlFragment | null {
  return session &&
    snapshot.items.get(itemId) &&
    liveEditingAvailable(session, snapshot)
    ? session.noteFragment(itemId)
    : null;
}

// One editor per shared fragment: a reloaded document brings new fragments.
const fragmentKeys = new WeakMap<Y.XmlFragment, number>();
let nextFragmentKey = 0;

/** A React key that changes when the note's shared text is replaced. */
export function fragmentKey(fragment: Y.XmlFragment): number {
  let key = fragmentKeys.get(fragment);
  if (key === undefined) {
    key = ++nextFragmentKey;
    fragmentKeys.set(fragment, key);
  }
  return key;
}
