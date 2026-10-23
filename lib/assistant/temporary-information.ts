export type TemporaryInformation = {
  id: string;
  title: string;
  kind: "workshop" | "promotion" | "event";
  discipline: string | null;
  details: string;
  promotion_starts_on: string;
  event_starts_on: string;
  event_ends_on: string;
  registration_deadline: string | null;
  status: "draft" | "published" | "archived";
};

export function isTemporaryInformationAnswerable(item: TemporaryInformation, today: string) {
  const answerUntil = item.registration_deadline ?? item.event_ends_on;
  return (
    item.status === "published" &&
    item.promotion_starts_on <= today &&
    item.event_ends_on >= today &&
    answerUntil >= today
  );
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX");
}

const ignoredWords = new Set([
  "a",
  "al",
  "algun",
  "alguna",
  "algunas",
  "algunos",
  "cual",
  "como",
  "con",
  "cuando",
  "cuanto",
  "de",
  "del",
  "donde",
  "el",
  "ella",
  "ellas",
  "ellos",
  "en",
  "es",
  "esta",
  "este",
  "esto",
  "la",
  "las",
  "lo",
  "los",
  "me",
  "mi",
  "mis",
  "para",
  "por",
  "que",
  "quien",
  "se",
  "sobre",
  "su",
  "sus",
  "un",
  "una",
  "unas",
  "uno",
  "unos",
  "y",
  "informacion",
  "info",
  "horario",
  "horarios",
  "precio",
  "precios",
  "costo",
  "costos",
  "hay",
  "tienen",
  "tienes",
  "disponible",
  "disponibles",
]);

const categoryWords: Record<TemporaryInformation["kind"], string[]> = {
  workshop: ["taller", "talleres", "curso", "cursos", "workshop", "workshops"],
  event: ["evento", "eventos"],
  promotion: ["promocion", "promociones", "promo", "promos"],
};

export function rankTemporaryInformation<T extends TemporaryInformation>(
  items: T[],
  topic: string,
) {
  const terms = normalize(topic)
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1 && !ignoredWords.has(term));
  const allCategoryWords = Object.values(categoryWords).flat();
  const specificTerms = terms.filter((term) => !allCategoryWords.includes(term));
  const categories = terms.filter((term) => allCategoryWords.includes(term));
  const ranked = items
    .map((item) => {
      const searchable = normalize(
        [item.title, item.kind, item.discipline ?? "", item.details].join(" "),
      );
      const score = specificTerms.reduce(
        (total, term) => total + (searchable.includes(term) ? 1 : 0),
        0,
      );
      const categoryMatch =
        categories.length === 0 ||
        categories.some((term) => categoryWords[item.kind].includes(term));
      return { item, score, categoryMatch };
    })
    .filter(
      ({ score, categoryMatch }) => categoryMatch && (specificTerms.length === 0 || score > 0),
    )
    .sort(
      (a, b) => b.score - a.score || a.item.event_starts_on.localeCompare(b.item.event_starts_on),
    )
    .slice(0, 8)
    .map(({ item }) => item);
  return ranked;
}

export function answerUntil(item: TemporaryInformation) {
  return item.registration_deadline ?? item.event_ends_on;
}
