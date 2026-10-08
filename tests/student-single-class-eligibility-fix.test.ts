import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("student single-class eligibility and checkout catalog sync", () => {
  const reserve = source("app/student/reservar/page.tsx");
  const migration = source(
    "supabase/migrations/20261007235900_single_class_checkout_catalog_sync.sql",
  );

  it("shows the actual eligibility reason instead of assuming an existing package", () => {
    expect(reserve).toContain("bookingReasonCopy(session.eligibility?.reason_code)");
    expect(reserve).not.toContain(
      '<p className="text-[11px] font-semibold text-amber-100">\n                            Esta clase no está incluida en tu paquete\n                          </p>',
    );
  });

  it("backs every configured drop-in price with an online single-class product", () => {
    expect(migration).toContain("coalesce(ct.drop_in_price_minor, 0) > 0");
    expect(migration).toContain("'single_class'::public.product_type");
    expect(migration).toContain("pt.online_purchasable = true");
    expect(migration).toContain("pt.price_minor = v_candidate.price_minor");
    expect(migration).toContain("ptd.discipline_id = v_candidate.discipline_id");
    expect(migration).toContain("insert into public.product_template_disciplines");
  });
});
