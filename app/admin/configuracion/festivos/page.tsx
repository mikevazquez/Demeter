import Link from "next/link";
import { redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import { saveOfficialHolidayStatusAction } from "./actions";

function safeYear(value?: string) {
  const year = Number(value);
  const current = new Date().getFullYear();
  return Number.isInteger(year) && year >= 2026 && year <= 2042 ? year : Math.max(current, 2026);
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

export default async function HolidaysConfigurationPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string;
    saved?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const year = safeYear(params.year);
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  const [{ data: holidays, error: holidaysError }, { data: overrides, error: overridesError }] =
    await Promise.all([
      ctx.supabase
        .from("official_holidays")
        .select("id,holiday_date,name,source_label")
        .eq("country_code", "MX")
        .eq("is_official", true)
        .gte("holiday_date", start)
        .lte("holiday_date", end)
        .order("holiday_date"),
      ctx.supabase
        .from("studio_holiday_overrides")
        .select("holiday_date,operation_mode")
        .eq("studio_id", ctx.studio.id)
        .gte("holiday_date", start)
        .lte("holiday_date", end),
    ]);

  if (holidaysError || overridesError) {
    console.error("[festivos.simple] load failed", {
      studioId: ctx.studio.id,
      year,
      holidaysError: holidaysError?.message,
      overridesError: overridesError?.message,
    });
  }

  const operationByDate = new Map(
    (overrides ?? []).map((item) => [item.holiday_date, item.operation_mode]),
  );

  const errorCopy: Record<string, string> = {
    invalid: "La fecha del festivo no es válida.",
    not_found: "No encontramos ese festivo oficial.",
    save: "No pudimos guardar el cambio. Inténtalo nuevamente.",
  };

  return (
    <main className="dashboard-shell admin-ux04-secondary configuration-page">
      <header className="topbar">
        <div>
          <Link className="back-link compact" href="/admin/configuracion">
            ← Configuración
          </Link>
          <p className="eyebrow">CALENDARIO · {ctx.studio.name}</p>
          <h1 className="dashboard-title">Días festivos</h1>
          <p>Por ahora solo define si el estudio abre normalmente o permanece cerrado.</p>
        </div>

        <div className="flex items-center gap-2">
          <Link className="ghost-button" href={`/admin/configuracion/festivos?year=${year - 1}`}>
            ← {year - 1}
          </Link>
          <span className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/[0.06] px-4 py-2 text-sm font-semibold text-white">
            {year}
          </span>
          <Link className="ghost-button" href={`/admin/configuracion/festivos?year=${year + 1}`}>
            {year + 1} →
          </Link>
        </div>
      </header>

      {params.saved ? (
        <div className="notice success">Configuración guardada para {params.saved}.</div>
      ) : null}

      {params.error ? (
        <div className="notice error">
          {errorCopy[params.error] ?? "No pudimos completar el cambio."}
        </div>
      ) : null}

      <section className="panel">
        <p className="eyebrow">FESTIVOS OFICIALES · MÉXICO</p>
        <h2>{year}</h2>
        <p>
          Los días oficiales se cargan automáticamente. Marca únicamente si el estudio estará
          cerrado; si no, funcionará con horario normal.
        </p>

        <div className="mt-4 space-y-3">
          {(holidays ?? []).length ? (
            (holidays ?? []).map((holiday) => {
              const closed = operationByDate.get(holiday.holiday_date) === "closed";

              return (
                <article
                  key={holiday.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-white">{holiday.name}</h3>
                        <span className="rounded-full border border-fuchsia-500/25 bg-fuchsia-500/[0.08] px-2 py-0.5 text-[9px] font-semibold text-fuchsia-300">
                          Festivo oficial
                        </span>
                      </div>
                      <p className="mt-1 text-sm capitalize text-zinc-300">
                        {dateLabel(holiday.holiday_date)}
                      </p>
                      <p className="mt-1 text-[10px] text-zinc-600">{holiday.source_label}</p>
                    </div>

                    <form
                      action={saveOfficialHolidayStatusAction}
                      className="flex items-center gap-3"
                    >
                      <input type="hidden" name="year" value={year} />
                      <input type="hidden" name="holiday_date" value={holiday.holiday_date} />

                      <span
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                          closed
                            ? "border-rose-500/25 bg-rose-500/[0.07] text-rose-300"
                            : "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300"
                        }`}
                      >
                        {closed ? "Estudio cerrado" : "Horario normal"}
                      </span>

                      <button
                        type="submit"
                        name="closed"
                        value={closed ? "0" : "1"}
                        className={closed ? "ghost-button" : "primary-button"}
                      >
                        {closed ? "Marcar como abierto" : "Marcar como cerrado"}
                      </button>
                    </form>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-5 text-sm text-zinc-400">
              No encontramos festivos oficiales para {year}.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
