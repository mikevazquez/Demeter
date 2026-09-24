import type { CSSProperties, ReactNode } from "react";

import { getHolidayTheme } from "@/lib/holidays/theme";

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
  const label = new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));

  return label.charAt(0).toUpperCase() + label.slice(1);
}

function MexicanRibbon({
  className,
  rotate = 0,
}: {
  className?: string;
  rotate?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute block h-5 w-56 rounded-full opacity-95 shadow-[0_6px_18px_rgba(0,0,0,.22)] ${className ?? ""}`}
      style={{
        background:
          "linear-gradient(90deg, #006847 0 31%, #f7f7f7 31% 65%, #ce1126 65% 100%)",
        transform: `rotate(${rotate}deg)`,
      }}
    />
  );
}

function Fireworks({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 120 120"
      className={`pointer-events-none ${className}`}
      fill="none"
    >
      <g stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" opacity=".9">
        <path d="M21 23v10M21 53v10M1 43h10M31 43h10M7 29l7 7M28 50l7 7M35 29l-7 7M14 50l-7 7" />
        <path d="M91 7v11M91 45v11M66 31h11M105 31h11M73 13l8 8M101 41l8 8M109 13l-8 8M81 41l-8 8" />
        <path d="M78 71v9M78 104v9M57 92h9M90 92h9M63 77l7 7M86 100l7 7M93 77l-7 7M70 100l-7 7" />
      </g>
    </svg>
  );
}

function HolidayArtwork({ themeKey }: { themeKey: string }) {
  const common = "h-full w-full";

  if (themeKey === "revolution") {
    return (
      <svg aria-hidden="true" viewBox="0 0 160 160" className={common} fill="none">
        <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <path d="M100 46c18 0 33 5 39 12-9 6-23 9-39 9s-30-3-39-9c6-7 21-12 39-12Z" strokeWidth="3" />
          <path d="M79 54c3-14 12-23 22-23 11 0 20 9 23 23" strokeWidth="3" />
          <circle cx="101" cy="77" r="12" strokeWidth="3" />
          <path d="M93 90c-10 8-17 20-18 34M109 90c11 7 18 20 20 35M88 101l-14 29M114 102l15 28" strokeWidth="4" />
          <path d="M46 123c8-19 19-31 33-35 12-4 24-2 36 6M43 123c-7-13-17-20-29-20 6 13 14 22 24 27" strokeWidth="3" />
          <path d="M30 116c10 0 18 5 25 14M56 131c14-1 28 1 42 6" strokeWidth="3" />
        </g>
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".7">
          <path d="M25 24v10M25 54v10M5 44h10M35 44h10M11 30l7 7M32 51l7 7M39 30l-7 7M18 51l-7 7" />
          <path d="M139 18v7M139 40v7M126 33h7M146 33h7M130 24l5 5M148 42l5 5M152 24l-5 5M135 42l-5 5" />
        </g>
      </svg>
    );
  }

  if (themeKey === "labor_day") {
    return (
      <svg aria-hidden="true" viewBox="0 0 160 160" className={common} fill="none">
        <g stroke="currentColor" strokeWidth="8" strokeLinecap="round">
          <path d="M45 80h70" />
          <path d="M27 57v46M42 50v60M118 50v60M133 57v46" />
        </g>
      </svg>
    );
  }

  if (themeKey === "christmas") {
    return (
      <svg aria-hidden="true" viewBox="0 0 160 160" className={common} fill="none">
        <path d="M80 20 52 59h17L43 96h25l-18 30h60l-18-30h25L91 59h17L80 20Z" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
        <path d="M80 126v18" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
        <circle cx="63" cy="80" r="3" fill="currentColor" />
        <circle cx="94" cy="92" r="3" fill="currentColor" />
        <circle cx="80" cy="110" r="3" fill="currentColor" />
      </svg>
    );
  }

  if (themeKey === "constitution") {
    return (
      <svg aria-hidden="true" viewBox="0 0 160 160" className={common} fill="none">
        <path d="M47 28h57c7 0 13 6 13 13v90H47c-9 0-16-7-16-16V44c0-9 7-16 16-16Z" stroke="currentColor" strokeWidth="4" />
        <path d="M48 58h49M48 76h49M48 94h38" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        <path d="M117 42h13v89h-13" stroke="currentColor" strokeWidth="4" />
      </svg>
    );
  }

  if (themeKey === "independence") {
    return (
      <svg aria-hidden="true" viewBox="0 0 160 160" className={common} fill="none">
        <path d="M80 29c-20 0-34 16-34 37v24l-12 20h92l-12-20V66c0-21-14-37-34-37Z" stroke="currentColor" strokeWidth="4" />
        <path d="M67 111c2 11 7 18 13 18s11-7 13-18" stroke="currentColor" strokeWidth="4" />
        <path d="M80 17v12" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </svg>
    );
  }

  if (themeKey === "executive_transfer") {
    return (
      <svg aria-hidden="true" viewBox="0 0 160 160" className={common} fill="none">
        <path d="M28 67 80 31l52 36" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
        <path d="M38 69h84v58H38z" stroke="currentColor" strokeWidth="4" />
        <path d="M54 81v34M80 81v34M106 81v34M29 128h102" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </svg>
    );
  }

  if (themeKey === "benito_juarez") {
    return (
      <svg aria-hidden="true" viewBox="0 0 160 160" className={common} fill="none">
        <circle cx="80" cy="80" r="54" stroke="currentColor" strokeWidth="4" />
        <circle cx="80" cy="62" r="22" stroke="currentColor" strokeWidth="4" />
        <path d="M45 125c7-24 20-36 35-36s28 12 35 36" stroke="currentColor" strokeWidth="4" />
      </svg>
    );
  }

  return (
    <div className="relative h-full w-full text-current">
      <Fireworks className="absolute inset-0 h-full w-full" />
      <span className="absolute inset-0 grid place-items-center text-5xl font-black">✦</span>
    </div>
  );
}

function ClosedCopy({ name }: { name: string }) {
  return (
    <>
      <p className="text-[1.05rem] font-semibold leading-7 text-white sm:text-lg">
        El estudio permanecerá cerrado por {name}.
      </p>
      <p className="mt-1 text-sm leading-6 text-zinc-200">No habrá clases disponibles este día.</p>
    </>
  );
}

function OpenCopy({
  special,
  name,
}: {
  special: boolean;
  name: string;
}) {
  return (
    <>
      <p className="text-[1.05rem] font-semibold leading-7 text-white sm:text-lg">
        {special
          ? `Hoy operamos con horario especial por ${name}.`
          : `Hoy es ${name} y operamos con normalidad.`}
      </p>
      <p className="mt-1 text-sm leading-6 text-zinc-200">
        {special
          ? "Consulta las clases disponibles para este día."
          : "Puedes reservar tus clases como de costumbre."}
      </p>
    </>
  );
}

export function HolidayNotice({ holiday }: { holiday: StudentHolidaySnapshot }) {
  const theme = getHolidayTheme(holiday.theme_key);
  const closed = holiday.operation_mode === "closed";
  const special = holiday.operation_mode === "special";
  const heroStyle = {
    "--holiday-accent": theme.accent,
    "--holiday-secondary": theme.secondary,
    background: `
      radial-gradient(circle at 82% 18%, ${theme.accent}66, transparent 32%),
      radial-gradient(circle at 12% 100%, ${theme.secondary}44, transparent 40%),
      linear-gradient(145deg, rgba(123, 4, 63, .98), rgba(29, 6, 28, .98) 60%, rgba(8, 13, 23, .98))
    `,
  } as CSSProperties;

  const messageStyle = {
    background: `
      radial-gradient(circle at 8% 50%, ${theme.accent}35, transparent 30%),
      linear-gradient(135deg, rgba(37, 9, 32, .98), rgba(8, 13, 23, .98))
    `,
  } as CSSProperties;

  const icon: ReactNode = holiday.theme_key === "revolution" ? "⚑" : theme.icon;

  return (
    <section
      data-holiday-theme={holiday.theme_key}
      data-holiday-operation={holiday.operation_mode}
      className="space-y-3"
    >
      <article
        className="relative isolate overflow-hidden rounded-3xl border border-fuchsia-500/40 p-4 shadow-[0_24px_70px_rgba(0,0,0,.34)] sm:p-5"
        style={heroStyle}
      >
        <MexicanRibbon className="-left-16 bottom-16 z-0" rotate={20} />
        <MexicanRibbon className="-right-16 bottom-5 z-0" rotate={18} />

        <div className="pointer-events-none absolute -right-2 bottom-3 z-0 h-40 w-40 text-fuchsia-300/55 sm:h-48 sm:w-48">
          <HolidayArtwork themeKey={holiday.theme_key} />
        </div>
        <Fireworks className="absolute right-0 top-3 z-0 h-24 w-24 text-fuchsia-400/45" />

        <div className="relative z-10">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/10 bg-gradient-to-br from-fuchsia-600 to-rose-700 text-2xl text-white shadow-[0_10px_28px_rgba(255,10,138,.22)]"
            >
              {icon}
            </span>

            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold leading-tight text-white sm:text-2xl">
                {holiday.name}
              </h2>
              <p className="mt-1 text-sm text-zinc-200">{dateLabel(holiday.holiday_date)}</p>
              <span className="mt-2 inline-flex rounded-full bg-fuchsia-600/90 px-3 py-1 text-xs font-semibold text-white shadow-[0_8px_24px_rgba(255,10,138,.25)]">
                Festivo oficial
              </span>
            </div>
          </div>

          <div className="mt-24 max-w-[78%] sm:mt-28">
            {closed ? <ClosedCopy name={holiday.name} /> : <OpenCopy special={special} name={holiday.name} />}
          </div>
        </div>
      </article>

      <article
        className="relative isolate overflow-hidden rounded-3xl border border-fuchsia-500/25 px-4 py-4 shadow-[0_16px_44px_rgba(0,0,0,.24)]"
        style={messageStyle}
      >
        <MexicanRibbon className="-left-20 -bottom-2 z-0" rotate={13} />
        <MexicanRibbon className="-right-20 -bottom-3 z-0" rotate={-10} />

        <div className="relative z-10 grid grid-cols-[72px_1fr] items-center gap-4">
          <div className="relative h-[72px] w-[72px] text-fuchsia-400">
            <HolidayArtwork themeKey={holiday.theme_key} />
          </div>
          <p className="text-sm leading-6 text-zinc-100">{holiday.message}</p>
        </div>
      </article>
    </section>
  );
}
