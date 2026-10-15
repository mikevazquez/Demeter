import { workshopUuid } from "./admin";

export interface WorkshopEditorDate {
  sessionId: string;
  date: string;
  time: string;
  disciplineId: string;
  instructorId: string;
  spaceId: string;
  durationMinutes: number;
  capacity: number;
  priceMinor: number | null;
}
export interface WorkshopDraft {
  title: string;
  fullPriceMinor: number;
  allowIndividualSessions: boolean;
  requiresEnrollment: boolean | null;
  depositMode: "full" | "fixed" | "percent";
  depositValue: number | null;
  balanceDueLocal: string;
  overdueMode: "keep_and_notify" | "release_after_grace" | null;
  graceMinutes: number | null;
  dates: WorkshopEditorDate[];
}
export interface WorkshopEditorContext {
  draft: WorkshopDraft | null;
  revision: number | null;
  locked: boolean;
  timeZone: string;
  currency: string;
  studioPolicy: { requiresEnrollment: boolean; overdueMode: string; graceMinutes: number };
  disciplines: { id: string; name: string }[];
  instructors: { id: string; name: string }[];
  spaces: { id: string; name: string; capacity: number | null }[];
}
export interface WorkshopSaveState {
  error: string | null;
  saved?: { offerId: string; revision: number; replayed: boolean };
}

export function workshopDraftError(value: unknown, allowTitleOnly = false): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "Revisa los datos del taller.";
  const d = value as Record<string, unknown>;
  if (typeof d.title !== "string" || !d.title.trim() || d.title.trim().length > 80)
    return "Escribe un nombre de hasta 80 caracteres.";
  if (allowTitleOnly && Object.keys(d).length === 1) return null;
  if (
    !Number.isInteger(d.fullPriceMinor) ||
    (d.fullPriceMinor as number) <= 0 ||
    (d.fullPriceMinor as number) > 2_147_483_647
  )
    return "Indica un precio completo mayor a cero.";
  if (
    typeof d.allowIndividualSessions !== "boolean" ||
    ![true, false, null].includes(d.requiresEnrollment as boolean | null)
  )
    return "Revisa la configuración de venta e inscripción.";
  if (!["full", "fixed", "percent"].includes(String(d.depositMode)))
    return "Elige cómo se paga el taller.";
  if (
    d.depositMode === "full"
      ? d.depositValue !== null
      : typeof d.depositValue !== "number" ||
        !Number.isFinite(d.depositValue) ||
        d.depositValue <= 0 ||
        (d.depositMode === "fixed"
          ? !Number.isInteger(d.depositValue) || d.depositValue > (d.fullPriceMinor as number)
          : d.depositValue > 100 ||
            Math.abs(d.depositValue * 100 - Math.round(d.depositValue * 100)) > 1e-8)
  )
    return "Revisa el importe o porcentaje del anticipo.";
  if (
    typeof d.balanceDueLocal !== "string" ||
    (d.balanceDueLocal && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.balanceDueLocal)) ||
    (d.depositMode !== "full" && !d.balanceDueLocal)
  )
    return "Indica el vencimiento del saldo.";
  if (
    ![null, "keep_and_notify", "release_after_grace"].includes(d.overdueMode as string | null) ||
    (d.graceMinutes !== null &&
      (!Number.isInteger(d.graceMinutes) ||
        (d.graceMinutes as number) < 0 ||
        (d.graceMinutes as number) > 525600)) ||
    (d.overdueMode === "release_after_grace" && d.graceMinutes === null)
  )
    return "Revisa la política de saldo vencido y sus minutos de gracia.";
  if (!Array.isArray(d.dates) || !d.dates.length || d.dates.length > 100)
    return "Agrega entre 1 y 100 fechas.";
  const times = new Set<string>(),
    ids = new Set<string>();
  for (const raw of d.dates) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return "Revisa cada fecha del taller.";
    const row = raw as WorkshopEditorDate;
    if (
      typeof row.sessionId !== "string" ||
      (row.sessionId && (!workshopUuid.test(row.sessionId) || ids.has(row.sessionId)))
    )
      return "Hay una sesión repetida o inválida.";
    if (row.sessionId) ids.add(row.sessionId);
    if (
      typeof row.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
      !Number.isFinite(Date.parse(row.date + "T00:00:00Z")) ||
      new Date(row.date + "T00:00:00Z").toISOString().slice(0, 10) !== row.date ||
      typeof row.time !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time)
    )
      return "Indica fecha y hora válidas.";
    if (
      !workshopUuid.test(row.disciplineId) ||
      ![row.instructorId, row.spaceId].every(
        (id) => typeof id === "string" && (!id || workshopUuid.test(id)),
      )
    )
      return "Revisa disciplina, coach y espacio.";
    if (
      !Number.isInteger(row.durationMinutes) ||
      row.durationMinutes < 15 ||
      row.durationMinutes > 360 ||
      !Number.isInteger(row.capacity) ||
      row.capacity < 1 ||
      row.capacity > 10000
    )
      return "Revisa la duración y el cupo de cada fecha.";
    if (
      (row.priceMinor !== null &&
        (!Number.isInteger(row.priceMinor) ||
          row.priceMinor < 0 ||
          row.priceMinor > 2_147_483_647)) ||
      (d.allowIndividualSessions && (row.priceMinor === null || row.priceMinor <= 0))
    )
      return "Indica el precio individual de cada fecha.";
    const key = row.date + "T" + row.time;
    if (times.has(key)) return "Hay fechas con el mismo horario.";
    times.add(key);
  }
  return null;
}

export function workshopEditorError(message: string) {
  const errors: [string, string][] = [
    [
      "workshop_revision_conflict",
      "Otra persona modificó el taller. Vuelve a abrirlo antes de guardar.",
    ],
    ["workshop_edit_locked", "Este taller ya tiene actividad. Solo se puede cambiar el nombre."],
    [
      "idempotency_conflict",
      "Esta solicitud ya se usó con otros datos. Reabre el taller para revisar su estado.",
    ],
    ["session_conflict", "Un coach o espacio ya está ocupado en uno de los horarios."],
    ["invalid_space", "Revisa el espacio y su capacidad para cada fecha."],
    ["invalid_instructor", "Elige un coach activo de este estudio."],
    ["invalid_discipline", "Elige una disciplina activa de este estudio."],
    ["invalid_workshop_session", "Una de las sesiones no pertenece a este taller."],
    ["duplicate_workshop_date", "Hay fechas con el mismo horario."],
    ["invalid_workshop_date", "Las fechas deben ser válidas y estar en el futuro."],
    ["balance_due", "Revisa el vencimiento del saldo; debe ser una fecha futura."],
    ["forbidden", "Tu cuenta no tiene permiso para configurar talleres."],
  ];
  return (
    errors.find(([code]) => message.includes(code))?.[1] ??
    "No pudimos guardar el taller. Revisa los datos y reintenta con esta misma solicitud."
  );
}
