/** Preflight capacity check. Server must repeat under session locks in a transaction. */
export type CapacityRow = {
  sessionId: string;
  capacity: number;
  confirmed: number;
  provisional: number;
};

export function workshopCapacityPreflight(
  requested: string[],
  rows: CapacityRow[],
): { ok: true; sortedIds: string[] } | { ok: false; reason: string } {
  if (!requested.length || new Set(requested).size !== requested.length ||
      requested.some((id) => !id)) return { ok: false, reason: "invalid_selection" };
  const byId = new Map(rows.map((row) => [row.sessionId, row]));
  if (byId.size !== rows.length) return { ok: false, reason: "invalid_capacity" };
  for (const id of requested) {
    const row = byId.get(id);
    if (!row || ![row.capacity, row.confirmed, row.provisional].every(Number.isSafeInteger) ||
        row.capacity < 0 || row.confirmed < 0 || row.provisional < 0)
      return { ok: false, reason: "invalid_capacity" };
    if (row.confirmed + row.provisional >= row.capacity)
      return { ok: false, reason: "sold_out" };
  }
  return { ok: true, sortedIds: [...requested].sort() };
}
