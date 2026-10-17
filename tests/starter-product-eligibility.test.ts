import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("starter product eligibility foundation", () => {
  const packageAction = source("app/admin/productos/por-clases/actions.ts");
  const packageForm = source("app/admin/productos/por-clases/CreateClassPackageForm.tsx");
  const portal = source("app/student/paquete/page.tsx");
  const checkout = source("supabase/functions/create-mercadopago-order/index.ts");
  const demiRead = source("lib/assistant/read-tools.ts");
  const demiGuidance = source("lib/assistant/conversation-guidance.ts");
  const foundation = source(
    "supabase/migrations/20261017184233_starter_product_eligibility_foundation.sql",
  );
  const fulfillmentGuard = source(
    "supabase/migrations/20261017184524_starter_checkout_post_payment_fulfillment_guard.sql",
  );
  const promoAmountFix = source(
    "supabase/migrations/20261017222343_starter_checkout_promo_enrollment_amount_fix.sql",
  );
  const transferEnrollment = source(
    "supabase/migrations/20261017222546_starter_transfer_promotional_enrollment.sql",
  );

  it("stores generic eligibility, purchase limit and enrollment inclusion", () => {
    expect(packageAction).toContain("purchase_eligibility");
    expect(packageAction).toContain("purchase_limit_per_student");
    expect(packageAction).toContain("enrollment_included");
    expect(packageForm).toContain("Solo personas nuevas");
    expect(packageForm).toContain("Incluir inscripción sin costo");
  });

  it("filters the student portal through server-side eligibility", () => {
    expect(portal).toContain('supabase.rpc("student_online_product_options")');
    expect(foundation).toContain("private.product_purchase_eligibility");
    expect(foundation).toContain("prior_pt.product_type::text in ('package','membership')");
    expect(foundation).toContain("purchase_limit_reached");
  });

  it("keeps one prior single class compatible with the new-customer offer", () => {
    expect(foundation).not.toContain(
      "prior_pt.product_type::text in ('single_class','package','membership')",
    );
  });

  it("includes enrollment as a promotion rather than a fake payment", () => {
    expect(foundation).toContain("'resolution','promotion'");
    expect(foundation).toContain("discount_kind");
    expect(foundation).toContain("'promotion'");
    expect(foundation).toContain("resolution_type");
  });

  it("surfaces eligibility errors before opening Mercado Pago", () => {
    expect(checkout).toContain('message.includes("new_customer_only")');
    expect(checkout).toContain('message.includes("purchase_limit_reached")');
    expect(checkout).toContain('message.includes("product_purchase_in_progress")');
  });

  it("keeps promotional enrollment out of the charged regular amount", () => {
    expect(promoAmountFix).toContain("(v_price->>'regular_amount_minor')::int+v_extra_price");
    expect(promoAmountFix).toContain("'regular_price_minor',v_enroll.price_minor");
  });

  it("supports promotional enrollment through Demi bank transfer", () => {
    expect(transferEnrollment).not.toContain(
      "included_enrollment_requires_online_or_staff_checkout",
    );
    expect(transferEnrollment).toContain("'promotion','100%'");
    expect(transferEnrollment).toContain("resolution_type='promotion'");
    expect(transferEnrollment).toContain("set status='cancelled'");
  });

  it("does not re-run eligibility after an accredited payment", () => {
    expect(fulfillmentGuard).toContain(
      "Eligibility is enforced before the provider order is created",
    );
    expect(fulfillmentGuard).not.toContain("v_eligibility := private.product_purchase_eligibility");
  });

  it("gives Demi eligibility metadata and prioritizes introductory offers", () => {
    expect(demiRead).toContain("service_product_purchase_eligibility");
    expect(demiRead).toContain("purchase_eligibility");
    expect(demiRead).toContain("enrollment_included");
    expect(demiGuidance).toContain("purchase_eligibility='new_customer'");
  });

  it("creates a derived entry-to-regular-package conversion model", () => {
    expect(foundation).toContain("student_entry_conversion_facts");
    expect(foundation).toContain("first_product_name");
    expect(foundation).toContain("converted_to_regular_package");
    expect(foundation).toContain("days_to_regular_package");
  });
});
