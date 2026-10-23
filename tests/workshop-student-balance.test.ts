import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("workshop visibility and balance collection from student profile", () => {
  const studentWorkshops = source("app/admin/alumnas/[studentId]/StudentWorkshops.tsx");
  const studentProfile = source("app/admin/alumnas/[studentId]/page.tsx");
  const saleDetail = source("app/admin/ventas/[saleId]/page.tsx");
  const saleActions = source("app/admin/ventas/actions.ts");

  it("surfaces workshop purchases in the default student summary when they exist", () => {
    expect(studentProfile).toContain(
      "<StudentWorkshops studentId={student.id} showEmpty={false} />",
    );
    expect(studentWorkshops).toContain("if (!purchases.length && !showEmpty) return null");
  });

  it("offers a balance action from each workshop purchase", () => {
    expect(studentWorkshops).toContain("<WorkshopPaymentForm");
    expect(source("app/admin/alumnas/[studentId]/WorkshopPaymentForm.tsx")).toContain(
      "Registrar abono o liquidación",
    );
    expect(studentWorkshops).toContain("/admin/ventas/\${p.saleId}");
  });

  it("uses the workshop collectible total when a workshop sale has no ordinary sale lines", () => {
    expect(saleDetail).toContain('from("workshop_purchases")');
    expect(saleDetail).toContain("workshopPurchase?.total_minor");
    expect(saleDetail).toContain("grossPaid >= collectibleTotal");
  });

  it("refreshes student views after a payment is registered", () => {
    expect(saleActions).toContain('revalidatePath("/admin/alumnas", "layout")');
  });
});
