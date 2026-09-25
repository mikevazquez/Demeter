import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-N14 PORTAL UX-06 Mi paquete", () => {
  const page = source("app/student/paquete/page.tsx");
  const actions = source("app/student/actions.ts");
  const button = source("app/student/paquete/purchase-package-button.tsx");

  it("answers how many classes remain and when they expire first", () => {
    expect(page).toContain('data-package-block="active"');
    expect(page).toContain("clases disponibles");
    expect(page).toContain("Vence el");
    expect(page).toContain("próxima clase reservada");
    expect(page).not.toContain("Progreso del paquete");
    expect(page).not.toContain('role="progressbar"');
  });

  it("keeps unlimited memberships simple", () => {
    expect(page).toContain("Clases ilimitadas");
    expect(page).not.toContain("no usa un límite de créditos");
  });

  it("keeps paid packages and extra classes visibly separate", () => {
    expect(page).toContain("reward_credit_wallet");
    expect(page).toContain("Clases extra");
    expect(page).toContain("clase extra disponible");
  });

  it("preserves booking, class usage, history and enrollment access", () => {
    expect(page).toContain('href="/student/reservar"');
    expect(page).toContain('href="/student/movimientos"');
    expect(page).toContain("Ver uso de mis clases");
    expect(page).toContain('data-package-block="history"');
    expect(page).toContain('data-package-block="enrollment"');
    expect(page).toContain("snapshot.enrollment");
  });

  it("keeps the real online catalog and Mercado Pago checkout contract", () => {
    expect(page).toContain('data-package-block="catalog"');
    expect(page).toContain('.eq("online_purchasable", true)');
    expect(page).toContain('.in("product_type", ["package", "membership"])');
    expect(page).toContain("PurchasePackageButton");
    expect(button).toContain("createMercadoPagoOrderAction(productTemplateId, requestKey)");
    expect(actions).toContain('supabase.functions.invoke("create-mercadopago-order"');
  });

  it("keeps product disciplines and prices data-driven", () => {
    expect(page).toContain('.from("product_template_disciplines")');
    expect(page).toContain('.from("disciplines")');
    expect(page).toContain("formatMoney(product.price_minor, product.currency)");
    expect(page).toContain("productDisciplineNames.get(product.id)");
  });

  it("distinguishes renewal from first purchase without inventing package data", () => {
    expect(page).toContain("Renovar o cambiar paquete");
    expect(page).toContain("Elige tu paquete");
    expect(page).toContain("Revisa las clases, vigencia y precio antes de pagar.");
  });
});
