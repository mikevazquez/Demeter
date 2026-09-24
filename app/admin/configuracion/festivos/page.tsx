import Link from "next/link";
import { redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import {
  bulkCalendarDayOperationAction,
  createManualCalendarDayAction,
  deleteManualCalendarDayAction,
  saveCalendarDayAction,
} from "./actions";

function safeYear(value?: string) {
  const year = Number(value);
  const current = new Date().getFullYear();
  return Number.isInteger(year) && year >= 2026 && year <= 2042 ? year : Math.max(current, 2026);
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function operationLabel(mode: string) {
  if (mode === "closed") return "Estudio cerrado";
  if (mode === "special") return "Horario especial";
  return "Horario normal";
}

export default async function HolidaysConfigurationPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string;
    saved?: string;
    created?: string;
    deleted?: string;
    bulk?: string;
    mode?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const year = safeYear(params.year);
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  if (ctx.membership.role !== "owner") redirect("/admin?error=access");

  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  const [officialResult, overrideResult] = await Promise.all([
    ctx.supabase
      .from("official_holidays")
      .select("id,holiday_date,name,theme_key,default_message,source_label,source_url,legal_basis")
      .eq("country_code", "MX")
      .eq("is_official", true)
      .gte("holiday_date", start)
      .lte("holiday_date", end)
      .order("holiday_date"),
    ctx.supabase
      .from("studio_holiday_overrides")
      .select(
        "id,official_holiday_id,holiday_date,operation_mode,student_message,source_kind,custom_name,theme_key,hero_image_path,message_image_path",
      )
      .eq("studio_id", ctx.studio.id)
      .gte("holiday_date", start)
      .lte("holiday_date", end)
      .order("holiday_date"),
  ]);

  if (officialResult.error || overrideResult.error) {
    console.error("[festivos.config] Failed loading configuration center", {
      official: officialResult.error?.message,
      overrides: overrideResult.error?.message,
      studioId: ctx.studio.id,
      year,
    });
  }

  const official = officialResult.data ?? [];
  const overrides = overrideResult.data ?? [];
  const overrideByDate = new Map(overrides.map((item) => [item.holiday_date, item]));
  const officialDates = new Set(official.map((item) => item.holiday_date));

  const rows = official.map((item) => {
    const override = overrideByDate.get(item.holiday_date);
    return {
      date: item.holiday_date,
      name: item.name,
      sourceKind: "official" as const,
      operationMode: override?.operation_mode ?? "normal",
      message: override?.student_message ?? item.default_message,
      themeKey: override?.theme_key ?? item.theme_key,
      heroPath: override?.hero_image_path ?? null,
      messagePath: override?.message_image_path ?? null,
      heroUrl: override?.hero_image_path
        ? ctx.supabase.storage.from("holiday-artwork").getPublicUrl(override.hero_image_path).data
            .publicUrl
        : null,
      messageUrl: override?.message_image_path
        ? ctx.supabase.storage.from("holiday-artwork").getPublicUrl(override.message_image_path)
            .data.publicUrl
        : null,
      sourceLabel: item.source_label,
    };
  });

  for (const override of overrides) {
    if (override.source_kind !== "manual" || officialDates.has(override.holiday_date)) continue;

    rows.push({
      date: override.holiday_date,
      name: override.custom_name ?? "Día especial",
      sourceKind: "manual" as const,
      operationMode: override.operation_mode ?? "normal",
      message: override.student_message ?? "",
      themeKey: override.theme_key ?? "custom",
      heroPath: override.hero_image_path ?? null,
      messagePath: override.message_image_path ?? null,
      heroUrl: override.hero_image_path
        ? ctx.supabase.storage.from("holiday-artwork").getPublicUrl(override.hero_image_path).data
            .publicUrl
        : null,
      messageUrl: override.message_image_path
        ? ctx.supabase.storage.from("holiday-artwork").getPublicUrl(override.message_image_path)
            .data.publicUrl
        : null,
      sourceLabel: "Agregado manualmente por el estudio",
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));

  const errorCopy: Record<string, string> = {
    invalid: "Revisa los datos de la fecha.",
    manual: "No pudimos agregar el día especial.",
    official_collision: "Esa fecha ya corresponde a un festivo oficial.",
    bulk: "Selecciona al menos una fecha.",
    bulk_save: "No pudimos aplicar la operación a todas las fechas.",
    save: "No pudimos guardar los cambios.",
    delete: "No pudimos eliminar el día especial.",
    image_type: "Usa imágenes PNG, JPG o WebP.",
    image_size: "Cada imagen debe pesar máximo 6 MB.",
    image_upload: "No pudimos subir la imagen.",
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
          <p>
            Configura todo el año desde un solo lugar. Los días seguirán apareciendo marcados dentro
            de Agenda.
          </p>
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
        <div className="notice success">Cambios guardados para {params.saved}.</div>
      ) : null}
      {params.created ? (
        <div className="notice success">Día especial agregado: {params.created}.</div>
      ) : null}
      {params.deleted ? (
        <div className="notice success">Día especial eliminado: {params.deleted}.</div>
      ) : null}
      {params.bulk ? (
        <div className="notice success">
          Operación aplicada a {params.bulk} fecha{params.bulk === "1" ? "" : "s"}.
        </div>
      ) : null}
      {params.error ? (
        <div className="notice error">
          {errorCopy[params.error] ?? "No pudimos completar el cambio."}
        </div>
      ) : null}

      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">OPERACIÓN ANUAL</p>
            <h2>{year} · Días festivos y especiales</h2>
            <p>
              Los oficiales se cargan automáticamente. También puedes agregar cierres o días
              especiales propios del estudio.
            </p>
          </div>
        </div>

        <details className="mt-4 rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.04]">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-fuchsia-300">
            + Agregar día especial
          </summary>
          <form
            action={createManualCalendarDayAction}
            className="grid gap-3 border-t border-white/10 p-4 md:grid-cols-2"
          >
            <input type="hidden" name="year" value={year} />
            <label className="branding-field">
              <span>Fecha</span>
              <input
                name="holiday_date"
                type="date"
                required
                min={`${year}-01-01`}
                max={`${year}-12-31`}
              />
            </label>
            <label className="branding-field">
              <span>Nombre</span>
              <input
                name="name"
                required
                minLength={2}
                maxLength={100}
                placeholder="Ej. Mantenimiento general"
              />
            </label>
            <label className="branding-field">
              <span>Operación</span>
              <select name="operation_mode" defaultValue="closed">
                <option value="normal">Horario normal</option>
                <option value="closed">Estudio cerrado</option>
                <option value="special">Horario especial</option>
              </select>
            </label>
            <label className="branding-field">
              <span>Mensaje para alumnas</span>
              <input name="student_message" maxLength={500} placeholder="Opcional" />
            </label>
            <div className="md:col-span-2">
              <button className="primary-button" type="submit">
                Agregar día especial
              </button>
            </div>
          </form>
        </details>
      </section>

      <form action={bulkCalendarDayOperationAction} className="panel">
        <input type="hidden" name="year" value={year} />

        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 pb-4">
          <strong className="text-sm text-white">Acción en bloque</strong>
          <select
            name="operation_mode"
            defaultValue="closed"
            className="min-h-10 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white"
          >
            <option value="closed">Cerrar seleccionados</option>
            <option value="normal">Horario normal</option>
            <option value="special">Horario especial</option>
          </select>
          <button className="primary-button" type="submit">
            Aplicar a seleccionados
          </button>
        </div>

        <p className="mt-3 text-[11px] leading-5 text-zinc-500">
          En Horario especial se conservan inicialmente las sesiones ya publicadas para evitar
          cancelaciones accidentales. Después puedes afinar ese día desde Agenda.
        </p>

        <div className="mt-4 space-y-3">
          {rows.length ? (
            rows.map((row) => (
              <article
                key={row.date}
                className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.025]"
              >
                <div className="grid gap-3 p-4 md:grid-cols-[auto_110px_minmax(0,1fr)_auto] md:items-center">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      name="selected_date"
                      value={row.date}
                      className="h-4 w-4 accent-fuchsia-500"
                      aria-label={`Seleccionar ${row.name}`}
                    />
                  </label>

                  <div>
                    <strong className="block text-sm text-white">{shortDate(row.date)}</strong>
                    <small className="text-[10px] text-zinc-500">{row.date}</small>
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-white">{row.name}</h3>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${
                          row.sourceKind === "official"
                            ? "border-fuchsia-500/25 bg-fuchsia-500/[0.08] text-fuchsia-300"
                            : "border-sky-500/25 bg-sky-500/[0.08] text-sky-300"
                        }`}
                      >
                        {row.sourceKind === "official" ? "Oficial" : "Manual"}
                      </span>
                      {row.heroUrl ? (
                        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/[0.06] px-2 py-0.5 text-[9px] text-emerald-300">
                          Imagen ✓
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">{row.sourceLabel}</p>
                  </div>

                  <span
                    className={`w-fit rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                      row.operationMode === "closed"
                        ? "border-rose-500/25 bg-rose-500/[0.07] text-rose-300"
                        : row.operationMode === "special"
                          ? "border-sky-500/25 bg-sky-500/[0.07] text-sky-300"
                          : "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300"
                    }`}
                  >
                    {operationLabel(row.operationMode)}
                  </span>
                </div>

                <details className="border-t border-white/10">
                  <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-fuchsia-300">
                    Personalizar operación, mensaje e imágenes
                  </summary>

                  <div className="grid gap-4 border-t border-white/10 bg-black/15 p-4 lg:grid-cols-2">
                    <label className="branding-field">
                      <span>Operación</span>
                      <select
                        name={`preview-operation-${row.date}`}
                        defaultValue={row.operationMode}
                        disabled
                      >
                        <option value="normal">Horario normal</option>
                        <option value="closed">Estudio cerrado</option>
                        <option value="special">Horario especial</option>
                      </select>
                      <small>
                        Usa el formulario individual de abajo para guardar cambios en este día.
                      </small>
                    </label>

                    <div className="branding-field">
                      <span>Mensaje actual</span>
                      <p className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs leading-5 text-zinc-300">
                        {row.message}
                      </p>
                    </div>

                    {row.heroUrl ? (
                      <div className="branding-field">
                        <span>Imagen principal actual</span>
                        <div
                          className="aspect-[16/9] rounded-2xl border border-white/10 bg-cover bg-center"
                          style={{ backgroundImage: `url("${row.heroUrl}")` }}
                        />
                      </div>
                    ) : null}

                    {row.messageUrl ? (
                      <div className="branding-field">
                        <span>Imagen temática actual</span>
                        <div
                          className="aspect-[3/1] rounded-2xl border border-white/10 bg-cover bg-center"
                          style={{ backgroundImage: `url("${row.messageUrl}")` }}
                        />
                      </div>
                    ) : null}
                  </div>
                </details>
              </article>
            ))
          ) : (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-5 text-sm text-zinc-400">
              No encontramos días configurables para {year}.
            </div>
          )}
        </div>
      </form>

      <section className="space-y-3">
        {rows.map((row) => (
          <details
            key={`edit-${row.date}`}
            className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02]"
          >
            <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-fuchsia-300">
              Editar {row.name} · {row.date}
            </summary>

            <form
              action={saveCalendarDayAction}
              className="grid gap-4 border-t border-white/10 bg-black/15 p-4 lg:grid-cols-2"
            >
              <input type="hidden" name="year" value={year} />
              <input type="hidden" name="holiday_date" value={row.date} />
              <input type="hidden" name="source_kind" value={row.sourceKind} />
              <input type="hidden" name="name" value={row.name} />
              <input type="hidden" name="theme_key" value={row.themeKey} />

              <label className="branding-field">
                <span>Operación</span>
                <select name="operation_mode" defaultValue={row.operationMode}>
                  <option value="normal">Horario normal</option>
                  <option value="closed">Estudio cerrado</option>
                  <option value="special">Horario especial</option>
                </select>
              </label>

              <label className="branding-field">
                <span>Mensaje temático</span>
                <textarea
                  name="student_message"
                  defaultValue={row.message}
                  maxLength={500}
                  rows={4}
                />
              </label>

              <div className="branding-field">
                <span>Imagen principal</span>
                {row.heroUrl ? (
                  <div
                    className="mb-2 aspect-[16/9] rounded-2xl border border-white/10 bg-cover bg-center"
                    style={{ backgroundImage: `url("${row.heroUrl}")` }}
                  />
                ) : null}
                <input name="hero_image" type="file" accept="image/png,image/jpeg,image/webp" />
                {row.heroPath ? (
                  <label className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                    <input type="checkbox" name="remove_hero" value="1" />
                    Quitar imagen actual
                  </label>
                ) : null}
                <small>Arte editorial de la tarjeta principal · máximo 6 MB.</small>
              </div>

              <div className="branding-field">
                <span>Imagen de tarjeta temática</span>
                {row.messageUrl ? (
                  <div
                    className="mb-2 aspect-[3/1] rounded-2xl border border-white/10 bg-cover bg-center"
                    style={{ backgroundImage: `url("${row.messageUrl}")` }}
                  />
                ) : null}
                <input name="message_image" type="file" accept="image/png,image/jpeg,image/webp" />
                {row.messagePath ? (
                  <label className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                    <input type="checkbox" name="remove_message" value="1" />
                    Quitar imagen actual
                  </label>
                ) : null}
              </div>

              <div className="lg:col-span-2 flex flex-wrap items-center justify-between gap-3">
                <button className="primary-button" type="submit">
                  Guardar este día
                </button>

                {row.sourceKind === "manual" ? (
                  <button
                    type="submit"
                    formAction={deleteManualCalendarDayAction}
                    className="ghost-button text-rose-300"
                  >
                    Eliminar día especial
                  </button>
                ) : null}
              </div>
            </form>
          </details>
        ))}
      </section>
    </main>
  );
}
