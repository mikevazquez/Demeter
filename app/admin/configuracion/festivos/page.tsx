import Link from "next/link";
import { redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import { HolidayConfigurationClient, type CalendarDayRow } from "./HolidayConfigurationClient";

function safeYear(value?: string) {
  const year = Number(value);
  const current = new Date().getFullYear();
  return Number.isInteger(year) && year >= 2026 && year <= 2042 ? year : Math.max(current, 2026);
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
  const [{ data: official }, { data: overrides }] = await Promise.all([
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

  const overrideByDate = new Map((overrides ?? []).map((item) => [item.holiday_date, item]));
  const officialDates = new Set((official ?? []).map((item) => item.holiday_date));

  const rows: CalendarDayRow[] = (official ?? []).map((item) => {
    const override = overrideByDate.get(item.holiday_date);
    return {
      date: item.holiday_date,
      name: item.name,
      sourceKind: "official",
      operationMode:
        (override?.operation_mode as CalendarDayRow["operationMode"] | undefined) ?? "normal",
      message: override?.student_message ?? item.default_message,
      themeKey: override?.theme_key ?? item.theme_key,
      heroUrl: override?.hero_image_path
        ? ctx.supabase.storage.from("holiday-artwork").getPublicUrl(override.hero_image_path).data
            .publicUrl
        : null,
      messageUrl: override?.message_image_path
        ? ctx.supabase.storage.from("holiday-artwork").getPublicUrl(override.message_image_path)
            .data.publicUrl
        : null,
      configured: Boolean(override),
      sourceLabel: item.source_label,
    };
  });

  for (const override of overrides ?? []) {
    if (override.source_kind !== "manual" || officialDates.has(override.holiday_date)) continue;
    rows.push({
      date: override.holiday_date,
      name: override.custom_name ?? "Día especial",
      sourceKind: "manual",
      operationMode: override.operation_mode as CalendarDayRow["operationMode"],
      message: override.student_message ?? "",
      themeKey: override.theme_key ?? "custom",
      heroUrl: override.hero_image_path
        ? ctx.supabase.storage.from("holiday-artwork").getPublicUrl(override.hero_image_path).data
            .publicUrl
        : null,
      messageUrl: override.message_image_path
        ? ctx.supabase.storage.from("holiday-artwork").getPublicUrl(override.message_image_path)
            .data.publicUrl
        : null,
      configured: true,
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

      <HolidayConfigurationClient year={year} rows={rows} />
    </main>
  );
}
