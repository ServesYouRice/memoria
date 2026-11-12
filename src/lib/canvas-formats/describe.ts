/** "3 notes, 1 links" from `{ notes: 3, links: 1 }` (IMP-096). */
export function describeCounts(counts: Record<string, number>) {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${kind}`)
    .join(", ");
}
