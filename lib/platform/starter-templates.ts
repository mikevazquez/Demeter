// NEB-01-15 · Plantillas de arranque por tipo de estudio.
// PRECIOS DE EJEMPLO: Mike los valida antes de usarlas con clientes. Al aplicarlas, los paquetes
// quedan inactivos para que la dueña revise precios antes de vender.

export type StarterActivity = {
  name: string;
  discipline: string;
  durationMinutes: number;
  capacity: number;
  colorHex: string;
  creditCost: number;
  dropInPriceMinor: number;
};

export type StarterProduct = {
  name: string;
  productType: "package" | "membership" | "single_class" | "enrollment";
  priceMinor: number;
  creditLimit: number | null;
  unlimited: boolean;
  validityDays: number | null;
  packageTerm: "monthly" | null;
};

export type StarterScheduleSlot = { weekday: number; time: string; activity: string };

export type StarterTemplate = {
  key: "pole_aereos" | "yoga" | "pilates" | "baile";
  name: string;
  description: string;
  disciplines: string[];
  activities: StarterActivity[];
  products: StarterProduct[];
  schedule: StarterScheduleSlot[];
};

function pack(name: string, classes: number, priceMxn: number): StarterProduct {
  return {
    name,
    productType: "package",
    priceMinor: priceMxn * 100,
    creditLimit: classes,
    unlimited: false,
    validityDays: 30,
    packageTerm: "monthly",
  };
}

function commonProducts(prefix: string, prices: [number, number, number, number, number, number]) {
  const [single, four, eight, twelve, unlimited, enrollment] = prices;
  return [
    {
      name: `${prefix} · Clase suelta`,
      productType: "single_class",
      priceMinor: single * 100,
      creditLimit: 1,
      unlimited: false,
      validityDays: 30,
      packageTerm: null,
    },
    pack(`${prefix} · 4 clases`, 4, four),
    pack(`${prefix} · 8 clases`, 8, eight),
    pack(`${prefix} · 12 clases`, 12, twelve),
    {
      name: `${prefix} · Ilimitado mensual`,
      productType: "membership",
      priceMinor: unlimited * 100,
      creditLimit: null,
      unlimited: true,
      validityDays: 30,
      packageTerm: "monthly",
    },
    {
      name: "Inscripción anual",
      productType: "enrollment",
      priceMinor: enrollment * 100,
      creditLimit: null,
      unlimited: false,
      validityDays: 365,
      packageTerm: null,
    },
  ] satisfies StarterProduct[];
}

function activity(
  name: string,
  discipline: string,
  colorHex: string,
  durationMinutes = 60,
  capacity = 10,
  dropInPriceMxn = 200,
): StarterActivity {
  return {
    name,
    discipline,
    durationMinutes,
    capacity,
    colorHex,
    creditCost: 1,
    dropInPriceMinor: dropInPriceMxn * 100,
  };
}

const weekdays = [1, 2, 3, 4, 5];

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: "pole_aereos",
    name: "Pole y aéreos",
    description: "Pole fitness, exotic, flexibilidad, telas y aro. Cupo chico por barra o aparato.",
    disciplines: ["Pole", "Aéreos", "Flexibilidad"],
    activities: [
      activity("Pole Fitness", "Pole", "#FF0A8A", 60, 8, 220),
      activity("Exotic Pole", "Pole", "#B5179E", 60, 8, 220),
      activity("Flexibilidad", "Flexibilidad", "#8FE6C8", 60, 12, 180),
      activity("Telas", "Aéreos", "#7B61FF", 60, 6, 240),
      activity("Aro aéreo", "Aéreos", "#F6C453", 60, 6, 240),
    ],
    products: commonProducts("Pole", [220, 760, 1400, 1900, 2300, 300]),
    schedule: [
      ...weekdays.map((weekday) => ({ weekday, time: "09:00", activity: "Pole Fitness" })),
      ...weekdays.map((weekday) => ({ weekday, time: "19:00", activity: "Pole Fitness" })),
      { weekday: 2, time: "20:00", activity: "Exotic Pole" },
      { weekday: 4, time: "20:00", activity: "Telas" },
      { weekday: 6, time: "11:30", activity: "Flexibilidad" },
    ],
  },
  {
    key: "yoga",
    name: "Yoga",
    description: "Vinyasa, hatha, yin y restaurativo. Grupos medianos sobre tapete.",
    disciplines: ["Yoga"],
    activities: [
      activity("Vinyasa", "Yoga", "#8FE6C8", 60, 16, 180),
      activity("Hatha", "Yoga", "#7B61FF", 60, 16, 180),
      activity("Yin", "Yoga", "#CDB8EC", 75, 14, 180),
      activity("Restaurativo", "Yoga", "#F6C453", 60, 12, 180),
    ],
    products: commonProducts("Yoga", [180, 620, 1100, 1500, 1800, 250]),
    schedule: [
      ...weekdays.map((weekday) => ({ weekday, time: "07:00", activity: "Vinyasa" })),
      ...weekdays.map((weekday) => ({ weekday, time: "19:30", activity: "Hatha" })),
      { weekday: 3, time: "20:30", activity: "Yin" },
      { weekday: 0, time: "10:00", activity: "Restaurativo" },
    ],
  },
  {
    key: "pilates",
    name: "Pilates mat",
    description: "Pilates en tapete por niveles. Para reformer, agrega recursos y lugares después.",
    disciplines: ["Pilates"],
    activities: [
      activity("Pilates mat inicial", "Pilates", "#8FE6C8", 50, 12, 200),
      activity("Pilates mat intermedio", "Pilates", "#7B61FF", 50, 12, 200),
      activity("Pilates con aros y bandas", "Pilates", "#FF0A8A", 50, 12, 200),
    ],
    products: commonProducts("Pilates", [200, 700, 1300, 1750, 2100, 250]),
    schedule: [
      ...weekdays.map((weekday) => ({ weekday, time: "08:00", activity: "Pilates mat inicial" })),
      ...weekdays.map((weekday) => ({
        weekday,
        time: "18:30",
        activity: "Pilates mat intermedio",
      })),
      { weekday: 6, time: "10:00", activity: "Pilates con aros y bandas" },
    ],
  },
  {
    key: "baile",
    name: "Baile",
    description: "Heels, twerk, ritmos latinos y urbano. Grupos grandes en salón.",
    disciplines: ["Baile"],
    activities: [
      activity("Heels", "Baile", "#B5179E", 60, 20, 180),
      activity("Twerk", "Baile", "#FF0A8A", 60, 20, 180),
      activity("Ritmos latinos", "Baile", "#F6C453", 60, 24, 160),
      activity("Urbano", "Baile", "#7B61FF", 60, 20, 180),
    ],
    products: commonProducts("Baile", [180, 600, 1050, 1400, 1700, 250]),
    schedule: [
      { weekday: 1, time: "19:00", activity: "Heels" },
      { weekday: 2, time: "19:00", activity: "Twerk" },
      { weekday: 3, time: "19:00", activity: "Ritmos latinos" },
      { weekday: 4, time: "19:00", activity: "Urbano" },
      { weekday: 5, time: "19:00", activity: "Heels" },
      { weekday: 6, time: "12:00", activity: "Ritmos latinos" },
    ],
  },
];

export function starterTemplate(key: string) {
  return STARTER_TEMPLATES.find((template) => template.key === key) ?? null;
}

/** Lo que se manda a la base: sin horario (no se crean clases) y con paquetes inactivos. */
export function starterTemplatePayload(template: StarterTemplate) {
  return {
    key: template.key,
    disciplines: template.disciplines,
    activities: template.activities.map((item) => ({
      name: item.name,
      discipline: item.discipline,
      duration_minutes: item.durationMinutes,
      capacity: item.capacity,
      color_hex: item.colorHex,
      credit_cost: item.creditCost,
      drop_in_price_minor: item.dropInPriceMinor,
    })),
    products: template.products.map((item) => ({
      name: item.name,
      product_type: item.productType,
      price_minor: item.priceMinor,
      credit_limit: item.creditLimit,
      unlimited: item.unlimited,
      validity_days: item.validityDays,
      package_term: item.packageTerm,
    })),
  };
}
