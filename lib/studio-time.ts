// NEB-01-35 · Hora del estudio. Nébora v1 es solo para México, pero cada estudio puede estar en
// otra zona (Tijuana, Cancún, Hermosillo…). Todo "hoy", "este mes" y cada hora que escribe una
// persona se calculan con la zona del estudio (studios.timezone). Si falta o no es válida, se usa
// la hora del centro de México, que es la de Demeter.

export const DEFAULT_STUDIO_TIME_ZONE = "America/Mexico_City";

/** Zonas horarias de México que se ofrecen al configurar un estudio. */
export const MEXICO_TIME_ZONES: { value: string; label: string }[] = [
  { value: "America/Mexico_City", label: "Centro (CDMX, Guadalajara, Puebla)" },
  { value: "America/Monterrey", label: "Centro (Monterrey)" },
  { value: "America/Merida", label: "Centro (Mérida)" },
  { value: "America/Cancun", label: "Sureste (Cancún, Quintana Roo)" },
  { value: "America/Chihuahua", label: "Chihuahua" },
  { value: "America/Mazatlan", label: "Pacífico (Mazatlán, La Paz, Nayarit)" },
  { value: "America/Hermosillo", label: "Sonora (Hermosillo)" },
  { value: "America/Tijuana", label: "Noroeste (Tijuana, Mexicali)" },
  { value: "America/Ciudad_Juarez", label: "Ciudad Juárez" },
  { value: "America/Matamoros", label: "Frontera noreste (Matamoros, Reynosa)" },
];

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Zona del estudio lista para usar; nunca lanza error. */
export function resolveStudioTimeZone(value: string | null | undefined): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  return candidate && isValidTimeZone(candidate) ? candidate : DEFAULT_STUDIO_TIME_ZONE;
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveStudioTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Fecha local del estudio en formato AAAA-MM-DD. */
export function studioLocalDateKey(timeZone: string | null | undefined, now: Date = new Date()) {
  const { year, month, day } = zonedParts(now, resolveStudioTimeZone(timeZone));
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Diferencia con UTC del estudio en ese instante, en minutos (CDMX = -360). */
export function studioOffsetMinutes(timeZone: string | null | undefined, at: Date = new Date()) {
  const p = zonedParts(at, resolveStudioTimeZone(timeZone));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/**
 * Convierte una hora escrita por una persona ("2026-11-02T18:30", sin zona) a un instante ISO,
 * entendiendo que es la hora local del estudio. Si ya trae zona (Z o ±HH:MM), se respeta.
 */
export function studioLocalDateTimeToIso(raw: string, timeZone: string | null | undefined) {
  const value = raw.trim();
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const wallUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0),
  );
  if (Number.isNaN(wallUtc)) return null;
  const zone = resolveStudioTimeZone(timeZone);
  // Dos pasadas para cubrir zonas con horario de verano (frontera norte).
  let instant = wallUtc - studioOffsetMinutes(zone, new Date(wallUtc)) * 60000;
  instant = wallUtc - studioOffsetMinutes(zone, new Date(instant)) * 60000;
  return new Date(instant).toISOString();
}

/** Valor para un <input type="datetime-local"> en la hora del estudio. */
export function studioDateTimeLocalValue(
  value: string | null | undefined,
  timeZone: string | null | undefined,
) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const p = zonedParts(date, resolveStudioTimeZone(timeZone));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
