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

  it("prioritizes the active package and its canonical credit breakdown", () => {
    expect(page).toContain('data-package-block="active"');
    expect(page).toContain("Disponibles");
    expect(page).toContain("Reservadas");
    expect(page).toContain("Utilizadas");
    expect(page).toContain("activePackage.available_credits");
    expect(page).toContain("activePackage.reserved_credits");
    expect(page).toContain("activePackage.used_credits");
  });

  it("shows finite-package progress without fabricating a percentage for unlimited packages", () => {
    expect(page).toContain("Progreso del paquete");
    expect(page).not.toContain('data-package-block="progress"');
    expect(page).toContain("progressPercent(activePackage)");
    expect(page).toContain("Acceso ilimitado");
    expect(page).toContain('role="progressbar"');
    expect(page).toContain("aria-valuenow={activeProgress}");
    expect(page).toContain('className="text-2xl text-fuchsia-300">∞');
  });

  it("preserves booking, movement, history and enrollment access", () => {
    expect(page).toContain('href="/student/reservar"');
    expect(page).toContain('href="/student/movimientos"');
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

  it("keeps product disciplines and prices data-driven instead of copying mockup examples", () => {
    expect(page).toContain('.from("product_template_disciplines")');
    expect(page).toContain('.from("disciplines")');
    expect(page).toContain("formatMoney(product.price_minor, product.currency)");
    expect(page).toContain("productDisciplineNames.get(product.id)");
    expect(page).not.toContain("Pilates Reformer");
    expect(page).not.toContain("$720");
    expect(page).not.toContain("Paquete 8 clases");
  });

  it("keeps the package screen on the approved dark-magenta visual language", () => {
    expect(page).toContain("bg-fuchsia-600");
    expect(page).toContain("border-fuchsia-500/20");
    expect(page).toContain("text-fuchsia-300");
    expect(page).toContain("bg-white/[0.03]");
  });
});
