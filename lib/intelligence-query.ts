// Reports must not silently stop at PostgREST's row limit.
export async function readIntelligenceRows<T>(query: {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>;
}) {
  const rows: T[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const result = await query.range(offset, offset + pageSize - 1);
    if (result.error) return { data: null, error: result.error };
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}

export async function readIntelligenceSessions<T>(
  sessionIds: string[],
  build: (ids: string[]) => Parameters<typeof readIntelligenceRows<T>>[0],
) {
  // Keep .in() URLs bounded when a studio has hundreds of sessions in the range.
  const rows: T[] = [];
  for (let start = 0; start < sessionIds.length; start += 200) {
    const result = await readIntelligenceRows(build(sessionIds.slice(start, start + 200)));
    if (result.error) return { data: null, error: result.error };
    rows.push(...(result.data ?? []));
  }
  return { data: rows, error: null };
}
