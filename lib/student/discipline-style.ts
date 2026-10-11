import type { CSSProperties } from "react";

/**
 * Personalidad visual por disciplina en el portal de alumna:
 * imagen propia, aura con el color de la actividad y motivos tenues en la esquina.
 *
 * Las imágenes viven en /public/disciplinas. Más adelante el estudio podrá subir
 * su propia imagen desde la configuración de cada Actividad.
 */

type DisciplineStyle = {
  key: string;
  pattern: RegExp;
  motif: string;
  image: string;
};

// El orden importa: "Exotic Pole" debe resolverse antes que "Pole".
const DISCIPLINES: DisciplineStyle[] = [
  { key: "espiral", pattern: /espiral/, motif: "🌀", image: "/disciplinas/espiral.jpg" },
  { key: "exotic", pattern: /exotic/, motif: "💋", image: "/disciplinas/exotic.jpg" },
  { key: "heels", pattern: /heels|tacon/, motif: "👠", image: "/disciplinas/heels.jpg" },
  { key: "twerk", pattern: /twerk/, motif: "🍑", image: "/disciplinas/twerk.jpg" },
  { key: "telas", pattern: /telas?\b/, motif: "🎀", image: "/disciplinas/telas.jpg" },
  { key: "aro", pattern: /\baro\b/, motif: "⭕", image: "/disciplinas/aro.jpg" },
  { key: "pendulo", pattern: /pendulo/, motif: "🦋", image: "/disciplinas/pendulo.jpg" },
  { key: "yoga", pattern: /yoga/, motif: "🪷", image: "/disciplinas/yoga.jpg" },
  { key: "flex", pattern: /flex/, motif: "🧘‍♀️", image: "/disciplinas/flexibilidad.jpg" },
  { key: "pole", pattern: /pole|tubo/, motif: "💫", image: "/disciplinas/pole.jpg" },
  {
    key: "danza-aerea",
    pattern: /danza\s+aerea/,
    motif: "🎀",
    image: "/disciplinas/telas.jpg",
  },
];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function findDiscipline(names: Array<string | null | undefined>) {
  const text = normalize(names.filter(Boolean).join(" "));
  return DISCIPLINES.find((item) => item.pattern.test(text)) ?? null;
}

export function disciplineMotif(...names: Array<string | null | undefined>) {
  return findDiscipline(names)?.motif ?? "✦";
}

export function disciplineImage(...names: Array<string | null | undefined>) {
  return findDiscipline(names)?.image ?? null;
}

function safeHex(color: string | null | undefined) {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : "#FF0A8A";
}

/** Fondo con aura del color de la clase para tarjetas de reserva. */
export function classAuraStyle(
  color: string | null | undefined,
  options: { muted?: boolean } = {},
): CSSProperties {
  const hex = safeHex(color);
  if (options.muted) {
    return {
      borderColor: "rgba(255,255,255,0.1)",
      background: "rgba(0,0,0,0.2)",
      filter: "saturate(0.35)",
    };
  }
  return {
    borderColor: `${hex}8c`,
    boxShadow: `0 0 28px ${hex}2e, inset 0 0 0 1px rgba(255,255,255,0.02)`,
    background: `radial-gradient(circle at 88% 8%, ${hex}57, transparent 34%), radial-gradient(circle at 6% 94%, ${hex}24, transparent 36%), linear-gradient(145deg, ${hex}21, rgba(7,11,18,0.96) 58%, ${hex}14)`,
  };
}
