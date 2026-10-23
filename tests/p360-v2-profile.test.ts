import { describe, expect, it } from "vitest";

import {
  birthdayState,
  buildPendingItems,
  type PendingInput,
} from "@/app/admin/alumnas/[studentId]/profile-pending";
import {
  resolveActivityFilter,
  resolveProfileTab,
} from "@/app/admin/alumnas/[studentId]/profile-tabs";
import { profile360Source } from "./support/profile360-source";

function input(overrides: Partial<PendingInput> = {}): PendingInput {
  return {
    studentId: "s1",
    lifecycleStatus: "active",
    canSell: true,
    canReadProducts: true,
    canReadSales: true,
    canManageAccess: true,
    pendingTransfers: 0,
    pendingCharges: { count: 0, amountMinor: 0 },
    pendingBalanceMinor: 0,
    accessBlocked: false,
    currentPackage: {
      name: "Paquete 8 clases",
      unlimited: false,
      availableCredits: 4,
      expiresOn: "2026-11-20",
    },
    hasScheduledPackage: false,
    lastPackageExpiredOn: null,
    renewalDue: false,
    enrollment: { active: true, expiresOn: "2027-03-01" },
    enrollmentExpiringSoon: false,
    hasNextClass: true,
    hasPortalAccount: true,
    birthday: null,
    money: (minor) => `$${minor / 100}`,
    date: (value) => value,
    ...overrides,
  };
}

describe("P360-V2-01 · pestañas del Perfil 360", () => {
  it("traduce cada vista anterior a su pestaña nueva", () => {
    expect(resolveProfileTab(undefined)).toBe("summary");
    expect(resolveProfileTab("followup")).toBe("summary");
    expect(resolveProfileTab("packages")).toBe("packages");
    expect(resolveProfileTab("rewards")).toBe("progress");
    expect(resolveProfileTab("evaluations")).toBe("progress");
    expect(resolveProfileTab("conversation")).toBe("activity");
    expect(resolveProfileTab("history")).toBe("activity");
    expect(resolveProfileTab("documents")).toBe("record");
    expect(resolveProfileTab("profile")).toBe("record");
    expect(resolveProfileTab("<script>")).toBe("summary");
  });

  it("abre Mensajes cuando llega un enlace viejo de conversación", () => {
    expect(resolveActivityFilter(undefined, "conversation")).toBe("messages");
    expect(resolveActivityFilter("payments", "activity")).toBe("payments");
    expect(resolveActivityFilter("nada", "activity")).toBe("all");
  });

  it("ya no tiene un segundo nivel de pestañas ni los 4 indicadores del Resumen", () => {
    const code = profile360Source();
    expect(code).not.toContain("crm-operation-tabs");
    expect(code).not.toContain("Compras históricas");
  });
});

describe("P360-V2-02 · pendientes del Resumen", () => {
  it("está al día cuando no hay nada que hacer", () => {
    expect(buildPendingItems(input())).toEqual([]);
  });

  it("pone primero lo urgente: transferencias y adeudos antes que avisos", () => {
    const items = buildPendingItems(
      input({
        pendingTransfers: 1,
        pendingCharges: { count: 1, amountMinor: 15000 },
        birthday: "today",
        renewalDue: true,
      }),
    );
    expect(items.map((item) => item.key)).toEqual(["transfer", "charges", "renewal", "birthday"]);
    expect(items[0].actions[0].href).toBe("/admin/alumnas/s1?view=packages#transferencias");
    expect(items[1].detail).toContain("$150");
  });

  it("avisa paquete vencido con acción de vender", () => {
    const [item] = buildPendingItems(
      input({ currentPackage: null, lastPackageExpiredOn: "2026-09-17", hasNextClass: false }),
    );
    expect(item.key).toBe("no_package");
    expect(item.title).toBe("Paquete vencido");
    expect(item.actions[0].href).toBe("/admin/ventas/nueva?student_id=s1");
  });

  it("no ofrece vender a quien no tiene permiso de ventas", () => {
    const [item] = buildPendingItems(input({ currentPackage: null, canSell: false }));
    expect(item.actions).toEqual([]);
  });

  it("no muestra pagos a quien no puede ver ventas", () => {
    const items = buildPendingItems(input({ canReadSales: false, pendingTransfers: 2 }));
    expect(items.find((item) => item.key === "transfer")).toBeUndefined();
  });

  it("marca el acceso a la app no enviado con reintento", () => {
    const [item] = buildPendingItems(input({ hasPortalAccount: false }));
    expect(item.key).toBe("access");
    expect(item.actions[0].href).toBe("/admin/alumnas/s1?view=record#acceso");
  });

  it("no genera pendientes de paquete para una exalumna", () => {
    const items = buildPendingItems(
      input({ lifecycleStatus: "inactive", currentPackage: null, hasPortalAccount: false }),
    );
    expect(items).toEqual([]);
  });

  it("calcula el cumpleaños del día y del mes", () => {
    expect(birthdayState("1995-10-23", "2026-10-23")).toBe("today");
    expect(birthdayState("1995-10-02", "2026-10-23")).toBe("this_month");
    expect(birthdayState("1995-03-02", "2026-10-23")).toBeNull();
    expect(birthdayState(null, "2026-10-23")).toBeNull();
  });
});

describe("P360-V2 · perfiles con datos incompletos", () => {
  it("no falla cuando la persona no tiene teléfono registrado", () => {
    const code = profile360Source();
    expect(code).toContain('?? student.phone ?? ""');
  });
});
