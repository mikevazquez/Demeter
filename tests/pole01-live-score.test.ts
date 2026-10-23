import { describe, expect, it } from "vitest";

import { poleLiveScore, type LiveBlock } from "../lib/pole/live-score";

function blocks(options: {
  combo: (number | null)[];
  mandatory: string[];
  dictated: string[];
}): LiveBlock[] {
  return [
    {
      key: "pole_combo",
      weightPercent: 40,
      items: options.combo.map((score, index) => ({
        id: `c${index}`,
        name: `Combo ${index}`,
        scored: true,
        maxScore: 10,
        weightPercent: 25,
        status: score === null ? "not_evaluated" : "meets",
        score,
      })),
    },
    {
      key: "pole_mandatory",
      weightPercent: 30,
      items: options.mandatory.map((status, index) => ({
        id: `m${index}`,
        name: `Obligatoria ${index + 1}`,
        scored: false,
        maxScore: 1,
        weightPercent: null,
        status,
        score: null,
      })),
    },
    {
      key: "pole_nomenclature",
      weightPercent: 30,
      items: options.dictated.map((status, index) => ({
        id: `d${index}`,
        name: `Dictada ${index + 1}`,
        scored: false,
        maxScore: 1,
        weightPercent: null,
        status,
        score: null,
      })),
    },
  ];
}

describe("POLE-01-16 live grade 40/30/30", () => {
  it("approves when everything meets and the minimum is reached", () => {
    const live = poleLiveScore(
      blocks({
        combo: [10, 10, 9, 9],
        mandatory: ["meets", "meets", "meets", "meets"],
        dictated: ["meets", "meets", "meets"],
      }),
      85,
    );
    expect(live.total).toBe(98);
    expect(live.outlook).toBe("approved");
    expect(live.missingMandatory).toEqual([]);
  });

  it("retains the promotion when only a mandatory figure is missing", () => {
    const live = poleLiveScore(
      blocks({
        combo: [10, 10, 10, 10],
        mandatory: ["meets", "meets", "meets", "does_not_meet"],
        dictated: ["meets", "meets", "meets"],
      }),
      85,
    );
    expect(live.total).toBe(92.5);
    expect(live.outlook).toBe("retained");
    expect(live.missingMandatory).toEqual(["Obligatoria 4"]);
  });

  it("stays below the minimum and reports incomplete captures", () => {
    expect(
      poleLiveScore(
        blocks({
          combo: [5, 5, 5, 5],
          mandatory: ["meets", "meets", "meets", "meets"],
          dictated: ["does_not_meet", "meets", "meets"],
        }),
        85,
      ).outlook,
    ).toBe("stays");
    expect(
      poleLiveScore(
        blocks({ combo: [10, null, 10, 10], mandatory: ["meets"], dictated: ["meets"] }),
        85,
      ).outlook,
    ).toBe("incomplete");
  });
});
