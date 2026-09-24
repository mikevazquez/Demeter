import type { CSSProperties, ReactNode } from "react";

import { getHolidayTheme } from "@/lib/holidays/theme";

export type StudentHolidaySnapshot = {
  holiday_id: string | null;
  holiday_code: string;
  holiday_date: string;
  name: string;
  theme_key: string;
  is_official: boolean;
  operation_mode: "normal" | "closed" | "special";
  message: string;
  configured: boolean;
  source_label: string;
  source_url: string | null;
  legal_basis: string | null;
  hero_image_path?: string | null;
  message_image_path?: string | null;
  hero_image_url?: string | null;
  message_image_url?: string | null;
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
      <svg aria-hidden="true" viewBox="0 0 360 220" className={common} fill="none">
        <defs>
          <linearGradient id="rev-cloud" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="currentColor" stopOpacity=".18" />
            <stop offset="1" stopColor="currentColor" stopOpacity=".03" />
          </linearGradient>
          <linearGradient id="rev-city" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="currentColor" stopOpacity=".34" />
            <stop offset="1" stopColor="currentColor" stopOpacity=".08" />
          </linearGradient>
        </defs>

        <g fill="url(#rev-cloud)">
          <ellipse cx="70" cy="104" rx="62" ry="24" />
          <ellipse cx="124" cy="96" rx="54" ry="29" />
          <ellipse cx="286" cy="83" rx="62" ry="24" />
          <ellipse cx="320" cy="102" rx="48" ry="22" />
        </g>

        <g fill="url(#rev-city)" stroke="currentColor" strokeOpacity=".42" strokeWidth="1.7">
          <path d="M249 155v-50h17v50M270 155V91h24v64M299 155v-39h18v39M321 155v-62h24v62" />
          <path d="M268 91h28l-14-18-14 18ZM318 93h30l-15-20-15 20Z" />
          <path d="M280 72c0-14 6-24 14-24s14 10 14 24" />
          <path d="M287 48V38h14v10M335 73V51h8v22" />
          <path d="M239 155h116" />
        </g>

        <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M94 159c-17-11-30-28-31-47 14-17 34-27 56-27 30 0 54 17 67 42 10 20 11 43 1 60"
            strokeWidth="4"
          />
          <path d="M76 112c-16 1-28-6-38-19 18-4 34 0 49 10" strokeWidth="4" />
          <path d="M79 117c8 0 15 3 22 9M66 132c9 8 18 13 28 15" strokeWidth="3" />
          <path d="M147 113c-8 7-13 16-17 28M157 121c8 11 12 24 12 39" strokeWidth="4" />
          <path d="M133 144c-20 2-37 12-51 30M151 146c13 5 24 15 33 30" strokeWidth="4" />

          <path d="M154 54c18 0 34 5 42 13-11 7-26 10-42 10s-31-3-42-10c8-8 24-13 42-13Z" strokeWidth="4" />
          <path d="M132 63c4-18 13-29 23-29 12 0 21 11 25 29" strokeWidth="4" />
          <circle cx="154" cy="91" r="14" strokeWidth="4" />
          <path d="M143 105c-12 9-20 22-22 38M166 105c13 9 21 23 23 39" strokeWidth="5" />
          <path d="M139 118l-18 42M170 118l21 42" strokeWidth="4" />
          <path d="M126 126l-15 12M180 127l16 10" strokeWidth="4" />

          <path d="M144 123l-8 20M164 123l9 20" strokeWidth="2.5" opacity=".75" />
        </g>

        <g stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" opacity=".8">
          <path d="M45 34v12M45 66v12M23 56h12M56 56h12M29 40l8 8M54 64l8 8M61 40l-8 8M37 64l-8 8" />
          <path d="M317 25v10M317 53v10M299 43h10M326 43h10M304 30l7 7M323 49l7 7M330 30l-7 7M311 49l-7 7" />
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
    background: holiday.hero_image_url
      ? `linear-gradient(180deg, rgba(9, 4, 11, .08) 0%, rgba(9, 4, 11, .14) 52%, rgba(9, 4, 11, .92) 100%), url("${holiday.hero_image_url}") center / cover no-repeat`
      : `
          radial-gradient(circle at 82% 18%, ${theme.accent}66, transparent 32%),
          radial-gradient(circle at 12% 100%, ${theme.secondary}44, transparent 40%),
          linear-gradient(145deg, rgba(123, 4, 63, .98), rgba(29, 6, 28, .98) 60%, rgba(8, 13, 23, .98))
        `,
  } as CSSProperties;

  const messageStyle = {
    background: holiday.message_image_url
      ? `linear-gradient(90deg, rgba(12, 5, 15, .38), rgba(7, 9, 16, .92)), url("${holiday.message_image_url}") center / cover no-repeat`
      : `
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
        className="relative isolate min-h-[445px] overflow-hidden rounded-3xl border border-fuchsia-500/45 px-4 pb-5 pt-4 shadow-[0_26px_78px_rgba(0,0,0,.4)] sm:min-h-[470px] sm:px-5 sm:pt-5"
        style={heroStyle}
      >
        {!holiday.hero_image_url ? (
          <div className="pointer-events-none absolute inset-x-0 top-[108px] z-0 h-[245px] sm:top-[116px] sm:h-[270px]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_66%_45%,rgba(255,10,138,.20),transparent_42%)]" />
            <MexicanRibbon className="-left-14 top-[86px] w-[285px] opacity-90" rotate={-11} />
            <MexicanRibbon className="-right-20 top-[148px] w-[310px] opacity-85" rotate={10} />
            <div className="absolute inset-x-2 bottom-0 top-0 text-fuchsia-300/70 sm:inset-x-4">
              <HolidayArtwork themeKey={holiday.theme_key} />
            </div>
            <Fireworks className="absolute right-1 top-0 h-28 w-28 text-fuchsia-300/55" />
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[48%] bg-gradient-to-t from-[#09070d] via-[#140713]/88 to-transparent" />

        <div className="relative z-10 flex min-h-[405px] flex-col sm:min-h-[428px]">
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
                {holiday.is_official ? "Festivo oficial" : "Día especial"}
              </span>
            </div>
          </div>

          <div className="mt-auto max-w-[88%] pb-1 sm:max-w-[82%]">
            {closed ? (
              <ClosedCopy name={holiday.name} />
            ) : (
              <OpenCopy special={special} name={holiday.name} />
            )}
          </div>
        </div>
      </article>

      <article
        className="relative isolate min-h-[142px] overflow-hidden rounded-3xl border border-fuchsia-500/30 px-4 py-4 shadow-[0_18px_52px_rgba(0,0,0,.3)] sm:min-h-[150px]"
        style={messageStyle}
      >
        {!holiday.message_image_url ? (
          <>
            <Fireworks className="absolute -left-1 top-1 h-20 w-20 text-fuchsia-400/35" />
            <MexicanRibbon className="-left-20 -bottom-2 z-0 w-[255px]" rotate={10} />
            <MexicanRibbon className="-right-24 -bottom-4 z-0 w-[285px]" rotate={-9} />
          </>
        ) : null}

        <div
          className={`relative z-10 grid min-h-[110px] items-center gap-4 ${
            holiday.message_image_url
              ? "grid-cols-1 pl-[42%] sm:pl-[38%]"
              : "grid-cols-[96px_1fr] sm:grid-cols-[112px_1fr]"
          }`}
        >
          {!holiday.message_image_url ? (
            <div className="relative h-[96px] w-[96px] text-fuchsia-300/85 sm:h-[108px] sm:w-[108px]">
              <HolidayArtwork themeKey={holiday.theme_key} />
            </div>
          ) : null}
          <p className="pr-1 text-[0.95rem] leading-6 text-zinc-100 sm:text-base">
            {holiday.message}
          </p>
        </div>
      </article>
    </section>
  );
}
