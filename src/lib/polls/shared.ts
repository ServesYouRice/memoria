/** IMP-104: client-safe poll result shapes shared by routes and the board. */

/** What every viewer of the poll sees; never who voted for what. */
export interface PollResult {
  itemId: string;
  multipleChoice: boolean;
  closed: boolean;
  closedAt: string | null;
  /** Votes per current choice id. */
  counts: Record<string, number>;
  /** People who voted for at least one current choice. */
  voters: number;
  /** The asking person's own choices. */
  myChoiceIds: string[];
}

/** The live notice a board receives when a poll's counts change. */
export function isPollChangedMessage(
  payload: unknown,
): payload is { type: "poll-changed"; itemId: string } {
  return (
    !!payload &&
    typeof payload === "object" &&
    (payload as { type?: unknown }).type === "poll-changed" &&
    typeof (payload as { itemId?: unknown }).itemId === "string"
  );
}
