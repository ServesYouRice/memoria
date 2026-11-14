/**
 * Window event that opens Ask with a question already typed (IMP-134).
 * The Search page sends it; `AskLauncher` listens. Nothing is sent to the
 * AI until the person submits.
 */
export const ASK_EVENT = "memoria:ask";

export interface AskEventDetail {
  question: string;
}
