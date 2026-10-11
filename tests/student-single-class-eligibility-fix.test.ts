import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("student single-class eligibility and checkout catalog sync", () => {
  const reserve = source("app/student/reservar/page.tsx");
  const detail = source("app/student/reservar/[sessionId]/page.tsx");
  const portal = source("lib/student/portal.ts");
  const catalogMigration = source(
    "supabase/migrations/20261007235900_single_class_checkout_catalog_sync.sql",
  );
  const demeterDropInMigration = source(
    "supabase/migrations/20261008000500_demeter_dropin_150.sql",
  );

  it("distinguishes expired, exhausted, and out-of-package states", () => {
    expect(portal).toContain('if (reason === "no_active_product")');
    expect(portal).toContain('return "Tu paquete ya venció"');
    expect(portal).toContain('if (reason === "no_credits")');
    expect(portal).toContain('return "Ya no tienes créditos disponibles"');
    expect(portal).toContain('reason === "outside_product_schedule"');
    expect(portal).toContain('return "Esta clase no está incluida en tu paquete"');
    expect(reserve).toContain("bookingReasonCopyForStudent");
    expect(detail).toContain("bookingReasonCopyForStudent");
  });

  it("routes package coverage failures to existing drop-in checkout in detail", () => {
    expect(reserve).toContain('"no_active_product"');
    expect(reserve).toContain('"outside_product"');
    expect(reserve).toContain('"outside_product_schedule"');
    expect(reserve).toContain('"no_credits"');
    expect(detail).toContain('"outside_product_schedule"');
    expect(reserve).toContain('needsPayment ? "Pagar" : "Ver"');
    expect(reserve).not.toContain("PurchaseSingleClassButton");
    expect(detail).toContain("PurchaseSingleClassButton");
  });

  it("backs configured drop-in prices with online single-class products", () => {
    expect(catalogMigration).toContain("coalesce(ct.drop_in_price_minor, 0) > 0");
    expect(catalogMigration).toContain("'single_class'::public.product_type");
    expect(catalogMigration).toContain("pt.online_purchasable = true");
    expect(catalogMigration).toContain("pt.price_minor = v_candidate.price_minor");
  });

  it("sets Demeter regular classes to the requested $150 drop-in price", () => {
    expect(demeterDropInMigration).toContain("slug = 'demeter-fitness'");
    expect(demeterDropInMigration).toContain("set drop_in_price_minor = 15000");
    expect(demeterDropInMigration).toContain("name not ilike 'DEMO ·%'");
    expect(demeterDropInMigration).toContain("pt.price_minor = 15000");
    expect(demeterDropInMigration).toContain("insert into public.product_template_disciplines");
  });
});
