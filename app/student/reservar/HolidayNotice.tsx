import type { CSSProperties } from "react";

import { getHolidayTheme, holidayOperationLabel } from "@/lib/holidays/theme";

export type StudentHolidaySnapshot = {
  holiday_id: string;
  holiday_code: string;
  holiday_date: string;
  name: string;
  theme_key: string;
  is_official: boolean;
  operation_mode: "normal" | "closed" | "special";
  message: string;
  configured: boolean;
  source_label: string;
  source_url: string;
  legal_basis: string;
};

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

export function HolidayNotice({ holiday }: { holiday: StudentHolidaySnapshot }) {
  const theme = getHolidayTheme(holiday.theme_key);
  const closed = holiday.operation_mode === "closed";
  const special = holiday.operation_mode === "special";
  const title = closed
    ? `El estudio permanecerá cerrado por ${holiday.name}.`
    : special
      ? `Hoy operamos con horario especial por ${holiday.name}.`
      : `Hoy es ${holiday.name} y operamos con normalidad.`;
  const detail = closed
    ? "No habrá clases disponibles este día."
    : special
      ? "Consulta las clases disponibles para este día."
      : "Puedes reservar tus clases como de costumbre.";

  const style = {
    "--holiday-accent": theme.accent,
    "--holiday-secondary": theme.secondary,
    borderColor: `${theme.accent}66`,
    background: `
      radial-gradient(circle at 86% 10%, ${theme.accent}44, transparent 30%),
      radial-gradient(circle at 8% 90%, ${theme.secondary}33, transparent 32%),
      linear-gradient(145deg, ${theme.accent}1f, rgba(7, 11, 18, .98) 52%, ${theme.secondary}18)
    `,
  } as CSSProperties;

  return (
    <section
      data-holiday-theme={holiday.theme_key}
      data-holiday-operation={holiday.operation_mode}
      className="relative overflow-hidden rounded-3xl border p-4 shadow-[0_20px_60px_rgba(0,0,0,.28)] sm:p-5"
      style={style}
    >
      <div className="pointer-events-none absolute right-4 top-2 select-none text-3xl font-black tracking-[0.4em] text-white/[0.06] sm:text-5xl">
        {theme.motif}
      </div>

      <div className="relative">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/15 bg-black/25 text-2xl"
            style={{ color: theme.accent, boxShadow: `0 0 28px ${theme.accent}22` }}
          >
            {theme.icon}
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white sm:text-xl">{holiday.name}</h2>
            <p className="mt-0.5 text-xs capitalize text-zinc-300">
              {dateLabel(holiday.holiday_date)}
            </p>
            <span
              className="mt-2 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold"
              style={{
                borderColor: `${theme.accent}66`,
                background: `${theme.accent}22`,
                color: "#ffd5eb",
              }}
            >
              Festivo oficial · {holidayOperationLabel(holiday.operation_mode)}
            </span>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4">
          <p className="text-base font-semibold leading-6 text-white">{title}</p>
          <p className="mt-1 text-xs leading-5 text-zinc-300">{detail}</p>
        </div>

        {closed ? (
          <div className="mt-3 flex gap-3 rounded-2xl border border-sky-400/20 bg-sky-400/[0.07] p-3">
            <span aria-hidden="true" className="text-lg text-sky-300">
              ⓘ
            </span>
            <p className="text-xs leading-5 text-sky-100/90">
              Si tenías una reserva, tu crédito será restaurado automáticamente cuando aplique.
            </p>
          </div>
        ) : null}

        <div
          className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-4"
          style={{ boxShadow: `inset 3px 0 0 ${theme.accent}` }}
        >
          <p className="text-sm leading-6 text-zinc-100">{holiday.message}</p>
        </div>

        <p className="mt-3 text-[9px] text-zinc-600">
          Fuente oficial: {holiday.source_label}
        </p>
      </div>
    </section>
  );
}
