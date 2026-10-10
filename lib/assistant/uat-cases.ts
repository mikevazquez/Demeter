export const DEMI_UAT_CASES = [
  ["M01", "Entrada por WhatsApp, Instagram y Facebook"],
  ["M02", "Identidad insuficiente y búsqueda"],
  ["M03", "No clasifica y reactivación"],
  ["M04", "Sin respuesta y dos seguimientos"],
  ["M05", "Pago externo antes de solicitar datos"],
  ["M06", "Reserva de grupo después del comprobante"],
  ["M07", "Sin cupo, alternativa y reembolso"],
  ["M08", "Primera reserva y bloqueo de duplicados"],
  ["M09", "Fallos, reintentos y trazabilidad"],
  ["M10", "Recordatorio y cancelación a cinco horas"],
  ["M11", "Asistencia e inscripción"],
  ["M12", "Comprobante rechazado y revocación"],
  ["M13", "Reserva de alumna y confirmación única"],
  ["M14", "Avisos, inactividad y recuperación de paquete"],
  ["M15", "Inscripción vencida con paquete vigente"],
  ["M16", "Retorno y recuperación de exalumna"],
  ["M17", "Atención humana transversal"],
  ["M18", "Conversación natural y multimedia"],
] as const;

export function validateUatCaseResult(caseId: string, status: string, evidence: string) {
  if (!DEMI_UAT_CASES.some(([id]) => id === caseId)) throw new Error("demi_uat_case_invalid");
  if (!["passed", "failed", "blocked", "partial"].includes(status)) {
    throw new Error("demi_uat_result_invalid");
  }
  if (evidence.trim().length < 10 || evidence.length > 4000) {
    throw new Error("demi_uat_case_evidence_required");
  }
  return { case_id: caseId, status, evidence: evidence.trim() };
}
