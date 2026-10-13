export type ProgramDate = {
  date: string;
  time: string;
  disciplineId: string;
  durationMinutes: number;
  capacity: number;
  priceMinor: number;
  instructorId: string;
  spaceId: string;
};
export type ProgramDraft = {
  name: string;
  description: string;
  kind: "workshop" | "event";
  fullPriceMinor: number;
  allowSingle: boolean;
  dates: ProgramDate[];
};
export function programError(program: ProgramDraft): string | null {
  if (
    !program ||
    typeof program.name !== "string" ||
    typeof program.description !== "string" ||
    !Array.isArray(program.dates) ||
    !["workshop", "event"].includes(program.kind)
  )
    return "Revisa los datos del programa.";
  if (!program.name.trim() || program.name.trim().length > 80)
    return "Escribe un nombre de hasta 80 caracteres.";
  if (program.description.length > 500) return "La descripción admite hasta 500 caracteres.";
  if (!Number.isSafeInteger(program.fullPriceMinor) || program.fullPriceMinor <= 0)
    return "Indica un precio total mayor a cero.";
  if (program.dates.length < 1 || program.dates.length > 100) return "Agrega entre 1 y 100 fechas.";
  const seen = new Set<string>();
  for (const row of program.dates) {
    if (!row || typeof row.date !== "string" || typeof row.time !== "string")
      return "Revisa los datos de cada fecha.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time))
      return "Indica fecha y hora válidas para cada sesión.";
    if (!row.disciplineId) return "Elige la disciplina de cada fecha.";
    if (
      !Number.isInteger(row.durationMinutes) ||
      row.durationMinutes < 15 ||
      row.durationMinutes > 360
    )
      return "La duración debe estar entre 15 y 360 minutos.";
    if (!Number.isInteger(row.capacity) || row.capacity < 1)
      return "Cada fecha necesita al menos un lugar.";
    if (
      program.allowSingle &&
      program.dates.length > 1 &&
      (!Number.isSafeInteger(row.priceMinor) || row.priceMinor <= 0)
    )
      return "Indica el precio de cada clase suelta.";
    const key = `${row.date}T${row.time}`;
    if (seen.has(key)) return "Hay fechas y horarios duplicados.";
    seen.add(key);
  }
  return null;
}
export function followingWeek(date: string) {
  if (!date) return "";
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + 7);
  return result.toISOString().slice(0, 10);
}
