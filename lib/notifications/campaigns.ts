export const CAMPAIGN_SEGMENTS = [
  ["all_eligible", "Todas las alumnas elegibles"],
  ["active_students", "Alumnas activas"],
  ["inactive_students", "Alumnas inactivas"],
  ["package_expiring", "Paquete por vencer"],
  ["package_expired", "Paquete vencido"],
  ["trial_no_purchase", "Clase de prueba sin compra"],
] as const;
export type CampaignTracking = {
  total: number;
  eligible: number;
  sent: number;
  pending: number;
  responded: number;
  purchased: number;
};
export function campaignState(status: string, tracking?: CampaignTracking | null) {
  return status === "draft"
    ? "Borrador"
    : status === "scheduled"
      ? "Programada"
      : tracking && tracking.pending === 0 && tracking.sent > 0
        ? "Enviada"
        : tracking && tracking.pending === 0
          ? "Sin entregas"
          : "En cola";
}
