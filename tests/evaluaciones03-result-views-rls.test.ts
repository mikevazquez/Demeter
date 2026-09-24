import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260924080000_evaluaciones03_result_views_rls_hardening.sql",
  ),
  "utf8",
);
const denyMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260924080500_evaluaciones03_result_views_deny_policy.sql",
  ),
  "utf8",
);

describe("EVALUACIONES-03 · result views RLS hardening", () => {
  it("enables RLS on the internal result read-receipt table", () => {
    expect(migration).toContain(
      "alter table public.student_evaluation_result_views\n  enable row level security",
    );
  });

  it("keeps direct client table access closed", () => {
    expect(migration).toContain(
      "revoke all on table public.student_evaluation_result_views\nfrom anon, authenticated",
    );
    expect(denyMigration).toContain('create policy "result views deny direct client access"');
    expect(denyMigration).toContain("to anon, authenticated");
    expect(denyMigration).toContain("using (false)");
    expect(denyMigration).toContain("with check (false)");
    expect(migration).not.toContain("grant select");
    expect(migration).not.toContain("grant insert");
  });
});
