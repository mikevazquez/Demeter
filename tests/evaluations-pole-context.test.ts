import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadPoleEvaluationContext } from "@/lib/evaluations/pole-context";

const input = {
  studioId: "studio-a",
  evaluationId: "evaluation-a",
  studentId: "student-a",
  disciplineId: "pole-a",
  templateElements: [{ id: "template-a", elementId: "figure-a" }],
  todayIso: "2026-10-20T15:00:00Z",
};

function database(hasCatalog = true, failedTable?: string) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const from = vi.fn((table: string) => {
    const result =
      table === "pole_figure_profiles"
        ? { count: hasCatalog ? 1 : 0, data: [{ element_id: "figure-a", figure_type: "Giro" }] }
        : table === "technical_elements"
          ? { data: [{ id: "figure-a", name: "Bombero" }] }
          : table === "student_pole_figure_achievements"
            ? {
                data: [
                  {
                    figure_element_id: "figure-a",
                    source: "instructor",
                    achieved_at: "2026-10-15T15:00:00Z",
                    validated_at: "2026-10-15T15:00:00Z",
                  },
                ],
              }
            : { data: [] };
    const query = {
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve({
          ...result,
          error: table === failedTable ? { message: "unavailable" } : null,
        }).then(resolve);
      },
    } as Record<string, unknown>;
    for (const method of ["select", "eq", "in", "order"]) {
      query[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return query;
      };
    }
    return query;
  });
  return {
    // Explicit PostgREST test double; the real database remains separate evidence.
    client: { from } as unknown as Parameters<typeof loadPoleEvaluationContext>[0],
    from,
    calls,
  };
}

describe("Pole evaluation reads the canonical catalogue achievements", () => {
  it("uses C1's figure ID and scopes every table read to the studio", async () => {
    const db = database();
    const context = await loadPoleEvaluationContext(db.client, input);
    expect(context?.baseHints["template-a"]).toMatchObject({ kind: "recent_class" });
    expect(context?.readiness).toMatchObject({ baseAchieved: 1, baseTotal: 1 });
    expect(context?.baseFigures["template-a"].achievement?.source).toBe("instructor");
    expect(db.from).toHaveBeenCalledWith("student_pole_figure_achievements");
    expect(db.from).not.toHaveBeenCalledWith("student_pole_achievements");
    expect(db.calls).toContainEqual({
      table: "student_pole_figure_achievements",
      method: "in",
      args: ["figure_element_id", ["figure-a"]],
    });
    for (const table of new Set(db.from.mock.calls.map(([name]) => name))) {
      expect(db.calls).toContainEqual({ table, method: "eq", args: ["studio_id", "studio-a"] });
    }
  });

  it("leaves disciplines without Pole catalogue on the ordinary evaluation flow", async () => {
    const db = database(false);
    expect(await loadPoleEvaluationContext(db.client, input)).toBeNull();
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it("does not query achievements for evaluations without a student", async () => {
    const db = database();
    const context = await loadPoleEvaluationContext(db.client, { ...input, studentId: null });
    expect(db.from).not.toHaveBeenCalledWith("student_pole_figure_achievements");
    expect(context?.baseHints["template-a"]).toEqual({ kind: "missing" });
  });

  it("does not present a failed progress read as missing achievements", async () => {
    for (const table of [
      "technical_evaluation_personal_items",
      "student_pole_figure_achievements",
    ]) {
      const db = database(true, table);
      expect(await loadPoleEvaluationContext(db.client, input)).toBeNull();
    }
  });
});
