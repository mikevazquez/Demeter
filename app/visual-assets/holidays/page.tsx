import Link from "next/link";

import { getHolidayAsset } from "@/lib/holidays/assets";

const holidays = [
  ["Año Nuevo", "new_year"],
  ["Día de Reyes", "reyes"],
  ["Día de la Candelaria", "candelaria"],
  ["Día de la Constitución", "constitution"],
  ["Día del Amor y la Amistad", "san_valentin"],
  ["Día de la Bandera", "bandera"],
  ["Día Internacional de la Mujer", "mujer"],
  ["Natalicio de Benito Juárez", "benito_juarez"],
  ["Expropiación Petrolera", "expropiacion_petrolera"],
  ["Semana Santa", "semana_santa"],
  ["Pascua", "pascua"],
  ["Día del Niño y la Niña", "dia_nino"],
  ["Día del Trabajo", "labor_day"],
  ["Batalla de Puebla", "batalla_puebla"],
  ["Día de las Madres", "dia_madres"],
  ["Día del Maestro y la Maestra", "dia_maestro"],
  ["Día del Padre", "dia_padre"],
  ["Niños Héroes", "ninos_heroes"],
  ["Día de la Independencia", "independence"],
  ["Día de la Raza", "dia_raza"],
  ["Halloween", "halloween"],
  ["Día de Muertos", "dia_muertos"],
  ["Revolución Mexicana", "revolution"],
  ["Día de la Virgen de Guadalupe", "guadalupe"],
  ["Inicio de las Posadas", "posadas"],
  ["Nochebuena", "nochebuena"],
  ["Navidad", "christmas"],
  ["Fin de Año", "fin_ano"],
] as const;

export default function HolidayAssetsReviewPage() {
  return (
    <main className="min-h-screen bg-[#08090e] px-4 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-7">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fuchsia-400">
            Demeter · Sandbox
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Festivos y fechas especiales de México</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Biblioteca visual aplicada al calendario. Las fechas oficiales conservan la lógica de
            apertura, cierre u horario especial; las conmemoraciones culturales son visuales y por
            defecto no modifican la operación del estudio.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {holidays.map(([name, themeKey]) => {
            const image = getHolidayAsset(themeKey);
            return (
              <article
                key={themeKey}
                className="overflow-hidden rounded-3xl border border-white/10 bg-[#11131b] shadow-[0_24px_70px_rgba(0,0,0,.28)]"
              >
                <div className="aspect-[16/9] overflow-hidden bg-black/30">
                  {image ? (
                    <img src={image} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <div className="p-4">
                  <h2 className="text-base font-semibold">{name}</h2>
                  <p className="mt-1 text-xs text-zinc-500">{themeKey}</p>
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-8">
          <Link
            href="/student/reservar"
            className="inline-flex min-h-11 items-center rounded-xl bg-fuchsia-600 px-4 text-sm font-semibold text-white"
          >
            Ver calendario de alumnas →
          </Link>
        </div>
      </div>
    </main>
  );
}
