/**
 * P360-V2-02 · Pendientes del Resumen.
 *
 * Arma, a partir de datos que ya existen, la lista de lo que hay que hacer con la persona,
 * ordenada por urgencia. No crea una fuente nueva: cada pendiente se deriva y cada acción usa
 * una pantalla o acción que ya existía.
 */
export type PendingTone = "bad" | "warn" | "info";

export type PendingAction = { label: string; href: string; primary?: boolean };

export type PendingItem = {
  key: string;
  tone: PendingTone;
  title: string;
  detail: string;
  actions: PendingAction[];
};

export type PendingInput = {
  studentId: string;
  lifecycleStatus: string;
  canSell: boolean;
  canReadProducts: boolean;
  canReadSales: boolean;
  canManageAccess: boolean;
  pendingTransfers: number;
  pendingCharges: { count: number; amountMinor: number };
  pendingBalanceMinor: number;
  accessBlocked: boolean;
  currentPackage: {
    name: string;
    unlimited: boolean;
    availableCredits: number | null;
    expiresOn: string | null;
  } | null;
  hasScheduledPackage: boolean;
  lastPackageExpiredOn: string | null;
  renewalDue: boolean;
  enrollment: { active: boolean; expiresOn: string | null } | null;
  enrollmentExpiringSoon: boolean;
  hasNextClass: boolean;
  hasPortalAccount: boolean;
  birthday: "today" | "this_month" | null;
  money: (minor: number) => string;
  date: (value: string) => string;
};

const toneOrder: Record<PendingTone, number> = { bad: 0, warn: 1, info: 2 };

export function buildPendingItems(input: PendingInput): PendingItem[] {
  const base = `/admin/alumnas/${input.studentId}`;
  const sell = `/admin/ventas/nueva?student_id=${input.studentId}`;
  const items: PendingItem[] = [];
  const active = input.lifecycleStatus !== "inactive";

  if (input.canReadSales && input.pendingTransfers > 0) {
    items.push({
      key: "transfer",
      tone: "bad",
      title:
        input.pendingTransfers === 1
          ? "Transferencia por validar"
          : `${input.pendingTransfers} transferencias por validar`,
      detail: "Revisa el comprobante y valida o rechaza el pago.",
      actions: [
        { label: "Ver comprobante", href: `${base}?view=packages#transferencias`, primary: true },
      ],
    });
  }

  if (input.canReadSales && input.pendingCharges.count > 0) {
    items.push({
      key: "charges",
      tone: "bad",
      title: "Penalización pendiente",
      detail:
        input.pendingCharges.count === 1
          ? `Tiene un cargo de ${input.money(input.pendingCharges.amountMinor)} sin resolver.`
          : `Tiene ${input.pendingCharges.count} cargos por ${input.money(input.pendingCharges.amountMinor)} sin resolver.`,
      actions: [{ label: "Ver adeudos", href: `${base}?view=packages#penalizaciones` }],
    });
  }

  if (input.canReadSales && (input.pendingBalanceMinor > 0 || input.accessBlocked)) {
    items.push({
      key: "balance",
      tone: "bad",
      title: "Saldo pendiente",
      detail:
        input.pendingBalanceMinor > 0
          ? `Quedan ${input.money(input.pendingBalanceMinor)} por cobrar.`
          : "El paquete está bloqueado por un pago pendiente.",
      actions: [{ label: "Ver ventas", href: `${base}?view=packages#ventas` }],
    });
  }

  if (input.canReadProducts && active) {
    const pkg = input.currentPackage;
    if (!pkg && !input.hasScheduledPackage) {
      items.push({
        key: "no_package",
        tone: "warn",
        title: input.lastPackageExpiredOn ? "Paquete vencido" : "Sin paquete activo",
        detail: input.lastPackageExpiredOn
          ? `Su último paquete venció el ${input.date(input.lastPackageExpiredOn)}.`
          : "No tiene un paquete vigente ni programado.",
        actions: input.canSell ? [{ label: "Vender paquete", href: sell, primary: true }] : [],
      });
    } else if (pkg && !pkg.unlimited && (pkg.availableCredits ?? 0) <= 0) {
      items.push({
        key: "no_credits",
        tone: "warn",
        title: "Sin clases disponibles",
        detail: `${pkg.name} sigue vigente pero ya no le quedan clases.`,
        actions: input.canSell ? [{ label: "Vender paquete", href: sell, primary: true }] : [],
      });
    } else if (pkg && input.renewalDue) {
      const left = pkg.unlimited
        ? "clases ilimitadas"
        : `${pkg.availableCredits ?? 0} ${pkg.availableCredits === 1 ? "clase" : "clases"}`;
      items.push({
        key: "renewal",
        tone: "warn",
        title: "Paquete por vencer",
        detail: `${pkg.name} vence el ${pkg.expiresOn ? input.date(pkg.expiresOn) : "pronto"} y le quedan ${left}.`,
        actions: [],
      });
    }
  }

  if (input.enrollment && active) {
    if (!input.enrollment.active) {
      items.push({
        key: "enrollment",
        tone: "warn",
        title: "Inscripción vencida",
        detail: input.enrollment.expiresOn
          ? `Venció el ${input.date(input.enrollment.expiresOn)}.`
          : "Revisa el estado de su inscripción.",
        actions: input.canSell ? [{ label: "Renovar inscripción", href: sell }] : [],
      });
    } else if (input.enrollmentExpiringSoon && input.enrollment.expiresOn) {
      items.push({
        key: "enrollment_soon",
        tone: "warn",
        title: "Inscripción por vencer",
        detail: `Vence el ${input.date(input.enrollment.expiresOn)}.`,
        actions: input.canSell ? [{ label: "Renovar inscripción", href: sell }] : [],
      });
    }
  }

  if (!input.hasPortalAccount && active) {
    items.push({
      key: "access",
      tone: "info",
      title: "Acceso a la app no enviado",
      detail: "El envío automático no se completó al darla de alta.",
      actions: input.canManageAccess
        ? [{ label: "Reintentar envío", href: `${base}?view=record#acceso` }]
        : [],
    });
  }

  if (input.birthday) {
    items.push({
      key: "birthday",
      tone: "info",
      title: input.birthday === "today" ? "Hoy es su cumpleaños" : "Cumple años este mes",
      detail:
        input.birthday === "today"
          ? "Buen momento para felicitarla."
          : "Considéralo para su siguiente contacto.",
      actions: [],
    });
  }

  if (input.currentPackage && !input.hasNextClass && active) {
    items.push({
      key: "next_class",
      tone: "info",
      title: "Sin próxima clase",
      detail: "Tiene paquete vigente pero no tiene clases reservadas.",
      actions: [{ label: "Reservar", href: `${base}/reservar` }],
    });
  }

  return items.sort((a, b) => toneOrder[a.tone] - toneOrder[b.tone]);
}

/** Cumpleaños a partir de la fecha de nacimiento (AAAA-MM-DD) y la fecha local del estudio. */
export function birthdayState(
  birthDate: string | null,
  today: string,
): "today" | "this_month" | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const monthDay = birthDate.slice(5);
  if (monthDay === today.slice(5)) return "today";
  return birthDate.slice(5, 7) === today.slice(5, 7) ? "this_month" : null;
}

export function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
