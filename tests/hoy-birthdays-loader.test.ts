import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { loadBirthdayStudents } from "@/app/admin/hoy/load-birthdays";

function database(rows: unknown[], definition: unknown = { id: "birth-field" }) {
  const queries: { table: string; calls: unknown[][] }[] = [];
  let offset = 0;
  const db = {
    from(table: string) {
      const query = { table, calls: [] as unknown[][] };
      queries.push(query);
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "order", "range", "returns"]) {
        builder[method] = (...args: unknown[]) => {
          query.calls.push([method, ...args]);
          if (method === "range") offset = Number(args[0]);
          return builder;
        };
      }
      builder.maybeSingle = () => Promise.resolve({ data: definition, error: null });
      builder.then = (resolve: (value: unknown) => void) =>
        resolve({ data: rows.slice(offset, offset + 200), error: null });
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, queries };
}

const row = {
  id: "ana",
  full_name: "Ana García",
  active: true,
  lifecycle_status: "active",
  student_type: "regular",
  trial_status: null,
  person: { profile_field_values: [{ value: "1994-11-14" }] },
  student_enrollments: [],
  product_acquisitions: [
    {
      status: "active",
      starts_on: "2026-11-01",
      expires_on: "2026-11-30",
      refunded_at: null,
      created_at: "2026-11-01",
      product_templates: { name: "Pole mensual", product_type: "package" },
    },
    {
      status: "active",
      starts_on: "2026-10-01",
      expires_on: "2026-10-31",
      refunded_at: null,
      created_at: "2026-10-01",
      product_templates: { name: "Vencido", product_type: "package" },
    },
    {
      status: "active",
      starts_on: "2026-11-01",
      expires_on: null,
      refunded_at: "2026-11-02",
      created_at: "2026-11-01",
      product_templates: { name: "Reembolsado", product_type: "package" },
    },
  ],
};

describe("Hoy birthday data boundary", () => {
  it("projects birthday and active package without returning a birth date or year", async () => {
    const { db, queries } = database([
      row,
      { ...row, id: "trial", student_type: "trial", trial_status: "pending" },
      { ...row, id: "missing", person: null },
    ]);
    const result = await loadBirthdayStudents(db, "studio-a", "2026-11-14");
    expect(result).toEqual([
      { id: "ana", name: "Ana García", month: 11, day: 14, packageLabel: "Pole mensual" },
    ]);
    expect(JSON.stringify(result)).not.toContain("1994");
    expect(queries[0].calls).toContainEqual(["eq", "studio_id", "studio-a"]);
    for (const path of [
      "studio_id",
      "person.studio_id",
      "person.profile_field_values.studio_id",
      "student_enrollments.studio_id",
      "product_acquisitions.studio_id",
    ]) {
      expect(queries[1].calls).toContainEqual(["eq", path, "studio-a"]);
    }
  });
  it("reads all pages rather than silently dropping birthdays after the API limit", async () => {
    const { db, queries } = database(
      Array.from({ length: 201 }, (_, i) => ({ ...row, id: String(i) })),
    );
    expect(await loadBirthdayStudents(db, "studio-a", "2026-11-14")).toHaveLength(201);
    expect(queries.filter((q) => q.table === "students")).toHaveLength(2);
  });
  it("reports a missing birth field without creating or changing schema", async () => {
    const { db, queries } = database([], null);
    await expect(loadBirthdayStudents(db, "studio-a", "2026-11-14")).rejects.toThrow(
      "birthday_field_unavailable",
    );
    expect(queries).toHaveLength(1);
  });
});
