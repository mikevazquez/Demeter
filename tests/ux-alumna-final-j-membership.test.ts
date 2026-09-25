import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ALUMNA UX FINAL J · membresía, compra y pagos", () => {
  const packagePage = source("app/student/paquete/page.tsx");
  const checkout = source("app/student/paquete/checkout/page.tsx");
  const movements = source("app/student/movimientos/page.tsx");
  const payments = source("app/student/pagos/page.tsx");

  it("keeps the membership mental model focused on remaining classes and expiry", () => {
    expect(packagePage).toContain("Mi paquete");
    expect(packagePage).toContain("clases disponibles");
    expect(packagePage).toContain("Vence el");
    expect(packagePage).toContain("Ver uso de mis clases");
  });

  it("keeps checkout reconciliation secure while hiding implementation language", () => {
    expect(checkout).toContain('supabase.functions.invoke("reconcile-mercadopago-order"');
    expect(checkout).toContain("No necesitas volver a pagar.");
    expect(checkout).toContain("No realices otro pago por ahora.");
    expect(checkout).toContain("Actualizar estado");
    expect(checkout).not.toContain("Studio Flow");
    expect(checkout).not.toContain("desde el servidor");
    expect(checkout).not.toContain("parámetros de la URL");
    expect(checkout).not.toContain("proveedor");
  });

  it("does not invent a payment product name that the snapshot does not expose", () => {
    expect(payments).toContain("payment.folio");
    expect(payments).toContain("payment.method");
    expect(payments).toContain("payment.reference");
    expect(payments).not.toContain("Studio Flow");
    expect(payments).not.toContain("F10");
  });

  it("uses classes rather than credits across the membership history", () => {
    expect(movements).toContain("Uso de mis clases");
    expect(movements).toContain("Clase devuelta");
    expect(movements).not.toContain("ledger");
    expect(movements).not.toContain("Studio Flow");
  });
});
