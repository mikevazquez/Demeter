import { formatDateTime, lifecycleCopy } from "./profile-format";

/** P360-V2-05 · Eventos de la línea de tiempo de Actividad, derivados de sus propias tablas. */
export type ProfileHistoryEvent = {
  id: string;
  at: string;
  kind: "class" | "package" | "sale" | "reward" | "status";
  title: string;
  detail: string;
  href?: string;
};

type ClassEvent = {
  id: string;
  status: string;
  className: string;
  startsAt: string;
  cancelledAt: string | null;
};

export function buildProfileHistory(input: {
  studentId: string;
  generalClassEvents: ClassEvent[];
  acquisitions: Array<{ id: string; created_at: string; product_template_id: string }>;
  currentAcquisitionId: string | null;
  productMap: Map<string, { name: string }>;
  transferPurchaseRows: Array<{
    id: string;
    status: string;
    amount_minor: number | null;
    currency: string | null;
    product_template_id: string;
    validated_at: string | null;
    rejected_at: string | null;
    receipt_received_at: string | null;
    created_at: string;
  }>;
  rewardAchievements: Array<{ id: string; title: string; unlockedAt: string }>;
  lifecycleEvents: Array<{
    id: string;
    from_status: string;
    to_status: string;
    created_at: string;
  }>;
  timeZone: string;
  locale: string;
  currency: string;
}) {
  const {
    generalClassEvents,
    acquisitions,
    productMap,
    transferPurchaseRows,
    rewardAchievements,
    lifecycleEvents,
    timeZone,
    locale,
    currency,
  } = input;
  const profileHistoryEvents: ProfileHistoryEvent[] = [];

  for (const event of generalClassEvents) {
    const classTitleMap: Record<string, string> = {
      reserved: "Clase reservada",
      attended: "Asistió a clase",
      cancelled_on_time: "Canceló clase a tiempo",
      cancelled_late: "Cancelación tardía",
      no_show: "No show",
      cancelled_by_studio: "Clase cancelada por el estudio",
    };
    const isCancellation = ["cancelled_on_time", "cancelled_late", "cancelled_by_studio"].includes(
      event.status,
    );
    profileHistoryEvents.push({
      id: "class:" + event.id,
      at: isCancellation && event.cancelledAt ? event.cancelledAt : event.startsAt,
      kind: "class",
      title: classTitleMap[event.status] ?? "Actividad de clase",
      detail: isCancellation
        ? `${event.className} · clase programada ${formatDateTime(event.startsAt, timeZone, locale)}`
        : event.className,
    });
  }

  for (const acquisition of acquisitions) {
    profileHistoryEvents.push({
      id: "package:" + acquisition.id,
      at: acquisition.created_at,
      kind: "package",
      title:
        acquisition.id === input.currentAcquisitionId ? "Paquete actual" : "Paquete registrado",
      detail: productMap.get(acquisition.product_template_id)?.name ?? "Paquete",
    });
  }

  for (const transfer of transferPurchaseRows) {
    const amount = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: transfer.currency ?? currency,
    }).format(Number(transfer.amount_minor ?? 0) / 100);
    const packageName = productMap.get(transfer.product_template_id)?.name ?? "Paquete";
    const title =
      transfer.status === "validated"
        ? "Transferencia validada"
        : transfer.status === "rejected"
          ? "Transferencia rechazada"
          : transfer.status === "provisional_active"
            ? "Comprobante de transferencia recibido"
            : transfer.status === "awaiting_receipt"
              ? "Transferencia pendiente de comprobante"
              : "Movimiento de transferencia";

    profileHistoryEvents.push({
      id: "transfer:" + transfer.id,
      at:
        transfer.validated_at ??
        transfer.rejected_at ??
        transfer.receipt_received_at ??
        transfer.created_at,
      kind: "sale",
      title,
      detail: `${packageName} · ${amount}`,
      href: `/admin/alumnas/${input.studentId}?view=packages#transferencias`,
    });
  }

  for (const achievement of rewardAchievements) {
    profileHistoryEvents.push({
      id: "reward:" + achievement.id,
      at: achievement.unlockedAt,
      kind: "reward",
      title: "Logro desbloqueado",
      detail: achievement.title,
    });
  }

  for (const event of lifecycleEvents) {
    profileHistoryEvents.push({
      id: "status:" + event.id,
      at: event.created_at,
      kind: "status",
      title: "Cambio de estado",
      detail:
        (lifecycleCopy[event.from_status] ?? event.from_status) +
        " → " +
        (lifecycleCopy[event.to_status] ?? event.to_status),
    });
  }

  profileHistoryEvents.sort((a, b) => b.at.localeCompare(a.at));
  return profileHistoryEvents;
}
