// POLE-01-16 · Live grade of a catalog evaluation (same rules as the v2 engine).

export type LiveItem = {
  id: string;
  name: string;
  scored: boolean;
  maxScore: number;
  weightPercent: number | null;
  status: string;
  score: number | null;
};

export type LiveBlock = {
  key: string;
  weightPercent: number;
  items: LiveItem[];
};

export type PoleLiveScore = {
  total: number;
  minimum: number;
  reachesMinimum: boolean;
  complete: boolean;
  blocks: Record<string, { percent: number; done: number; total: number }>;
  missingMandatory: string[];
  outlook: "approved" | "retained" | "stays" | "incomplete";
};

function itemPercent(item: LiveItem) {
  if (item.scored && item.score !== null) return Math.min((item.score / item.maxScore) * 100, 100);
  return item.status === "meets" ? 100 : 0;
}

function itemDone(item: LiveItem) {
  return item.status !== "not_evaluated" && (!item.scored || item.score !== null);
}

export function poleLiveScore(blocks: LiveBlock[], minimum: number): PoleLiveScore {
  let total = 0;
  let complete = true;
  const byKey: PoleLiveScore["blocks"] = {};

  for (const block of blocks) {
    const weights = block.items.reduce((sum, item) => sum + (item.weightPercent ?? 0), 0);
    const percent = block.items.reduce(
      (sum, item) =>
        sum +
        itemPercent(item) *
          (weights > 0 ? (item.weightPercent ?? 0) / 100 : 1 / Math.max(block.items.length, 1)),
      0,
    );
    const done = block.items.filter(itemDone).length;
    if (done < block.items.length || block.items.length === 0) complete = false;
    byKey[block.key] = {
      percent: Math.round(percent * 100) / 100,
      done,
      total: block.items.length,
    };
    total += (percent * block.weightPercent) / 100;
  }

  total = Math.round(total * 100) / 100;
  const missingMandatory = (blocks.find((block) => block.key === "pole_mandatory")?.items ?? [])
    .filter((item) => item.status === "does_not_meet")
    .map((item) => item.name);
  const reachesMinimum = total >= minimum;

  const outlook = !complete
    ? "incomplete"
    : !reachesMinimum
      ? "stays"
      : missingMandatory.length
        ? "retained"
        : "approved";

  return { total, minimum, reachesMinimum, complete, blocks: byKey, missingMandatory, outlook };
}
