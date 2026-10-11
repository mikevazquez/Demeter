import Image from "next/image";
import Link from "next/link";

import {
  bookingReasonCopyForStudent,
  getStudentPortalContext,
  localDateKey,
  type StudentSession,
} from "@/lib/student/portal";

import BookingEligibilityRefresh from "./BookingEligibilityRefresh";
import { QuickBookButton } from "./quick-book-button";
import { BookingRestrictionCard } from "./BookingRestrictionCard";
import { HolidayNotice, type StudentHolidaySnapshot } from "./HolidayNotice";
import { getHolidayTheme } from "@/lib/holidays/theme";
import { classAuraStyle, disciplineImage, disciplineMotif } from "@/lib/student/discipline-style";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeDate(value: string | undefined, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function startOfWeek(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  const weekday = date.getUTCDay();
  const distanceToMonday = weekday === 0 ? -6 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + distanceToMonday);
  return date.toISOString().slice(0, 10);
}

function dateChip(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat("es-MX", {
      weekday: "short",
      timeZone: "UTC",
    }).format(date),
    day: new Intl.DateTimeFormat("es-MX", {
      day: "numeric",
      timeZone: "UTC",
    }).format(date),
  };
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function longDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function timeOnly(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

type StudentWaitlistItem = {
  waitlist_entry_id: string;
  session_id: string;
  status: string;
  joined_at: string;
};

type RewardStatusSnapshot = {
  level_title?: string | null;
};

type HolidayWeekItem = {
  holiday_date: string;
  name: string;
  theme_key: string;
  operation_mode: "normal" | "closed" | "special";
};

function statusClass(session: StudentSession, waitlisted = false) {
  if (session.status === "cancelled") {
    return "border-rose-500/30 bg-rose-500/10 text-rose-300";
  }
  if (session.is_reserved) {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
  }
  if (waitlisted) {
    return "border-amber-400/30 bg-amber-400/[0.09] text-amber-200";
  }
  if (session.eligibility?.eligible) {
    return "border-fuchsia-500/25 bg-fuchsia-500/10 text-fuchsia-200";
  }
  if (session.eligibility?.reason_code === "session_full") {
    return "border-amber-400/30 bg-amber-400/[0.09] text-amber-200";
  }
  return "border-amber-400/25 bg-amber-400/[0.08] text-amber-200";
}

export default async function StudentReservePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string; credit?: string }>;
}) {
  const query = await searchParams;
  const rewardMode = query.credit === "reward";
  const rewardSuffix = rewardMode ? "&credit=reward" : "";
  const { supabase, studio, membership, snapshot } = await getStudentPortalContext();

  const today = localDateKey(new Date(), studio.timezone);
  const requestedDate = safeDate(query.date, today);
  const selectedDate = requestedDate < today ? today : requestedDate;
  const weekStart = startOfWeek(selectedDate);
  const currentWeekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const previousWeekDate = addDays(selectedDate, -7);
  const nextWeekDate = addDays(selectedDate, 7);

  const [
    { data: globalRestrictionData },
    { data: sessions, error },
    { data: selectedHolidayData },
    { data: holidayWeekData },
  ] = await Promise.all([
    supabase.rpc("student_booking_restrictions_snapshot", { p_session_id: null }),
    supabase.rpc("student_schedule_feed", {
      target_start: selectedDate,
      target_end: selectedDate,
      target_discipline_id: null,
    }),
    supabase.rpc("student_holiday_snapshot", { target_date: selectedDate }),
    supabase.rpc("student_holiday_week_snapshot", {
      target_start: weekStart,
      target_end: weekEnd,
    }),
  ]);
  const globalRestrictions = (globalRestrictionData ?? []) as NonNullable<
    StudentSession["eligibility"]["restrictions"]
  >;

  const selectedHolidayBase = (selectedHolidayData as StudentHolidaySnapshot | null) ?? null;
  const selectedHoliday = selectedHolidayBase
    ? {
        ...selectedHolidayBase,
        hero_image_url: selectedHolidayBase.hero_image_path
          ? supabase.storage
              .from("holiday-artwork")
              .getPublicUrl(selectedHolidayBase.hero_image_path).data.publicUrl
          : null,
        message_image_url: selectedHolidayBase.message_image_path
          ? supabase.storage
              .from("holiday-artwork")
              .getPublicUrl(selectedHolidayBase.message_image_path).data.publicUrl
          : null,
      }
    : null;
  const holidayWeekItems = (holidayWeekData ?? []) as HolidayWeekItem[];
  const holidayByDate = new Map(holidayWeekItems.map((holiday) => [holiday.holiday_date, holiday]));

  const baseItems = (sessions ?? []) as StudentSession[];
  const sessionIds = baseItems.map((item) => item.session_id);
  const [{ data: resourceRequirements }, { data: waitlistData }, { data: rewardStatusData }] =
    await Promise.all([
      sessionIds.length
        ? supabase
            .from("class_sessions")
            .select("id,requires_resource")
            .eq("studio_id", membership.studio_id)
            .in("id", sessionIds)
        : Promise.resolve({ data: [] as { id: string; requires_resource: boolean }[] }),
      supabase.rpc("student_waitlist_feed"),
      supabase.rpc("student_reward_status_snapshot"),
    ]);
  const resourceRequirementMap = new Map(
    (resourceRequirements ?? []).map((item) => [item.id, item.requires_resource]),
  );
  const items = baseItems.map((item) => ({
    ...item,
    requires_resource: resourceRequirementMap.get(item.session_id) ?? false,
  }));

  const waitlistItems = (waitlistData ?? []) as StudentWaitlistItem[];
  const waitlistedSessionIds = new Set(
    waitlistItems.filter((item) => item.status === "active").map((item) => item.session_id),
  );
  const levelTitle = (rewardStatusData as RewardStatusSnapshot | null)?.level_title ?? null;
  const activityNames = [...new Set(items.map((item) => item.activity))];
  const { data: activityStyles } = activityNames.length
    ? await supabase
        .from("class_templates")
        .select("name,color_hex,drop_in_price_minor")
        .eq("studio_id", membership.studio_id)
        .in("name", activityNames)
    : {
        data: [] as {
          name: string;
          color_hex: string | null;
          drop_in_price_minor: number | null;
        }[],
      };
  const activityStyleMap = new Map(
    (activityStyles ?? []).map((item) => [
      item.name,
      {
        color: item.color_hex ?? "#FF0A8A",
        dropInPriceMinor: item.drop_in_price_minor,
      },
    ]),
  );

  return (
    <main className="space-y-4 pb-4">
      <BookingEligibilityRefresh />
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
          Portal alumna
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">Reservar clase</h1>
        <p className="mt-1.5 text-xs leading-5 text-zinc-400">
          Elige una fecha para consultar la agenda completa de ese día.
        </p>
      </header>

      {globalRestrictions.length ? (
        <BookingRestrictionCard
          restrictions={globalRestrictions}
          returnTo={`/student/reservar?date=${selectedDate}${rewardSuffix}`}
        />
      ) : null}

      {rewardMode ? (
        <section className="rounded-2xl border border-emerald-400/35 bg-emerald-400/[0.07] px-4 py-3">
          <p className="text-xs font-semibold text-emerald-200">Usando créditos extra</p>
          <p className="mt-1 text-[11px] leading-5 text-zinc-400">
            Las reservas que confirmes desde este flujo se cobrarán del saldo premio disponible.
          </p>
        </section>
      ) : null}

      <section
        aria-label="Seleccionar fecha"
        className="rounded-3xl border border-white/10 bg-white/[0.03] p-3 sm:p-4"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          {weekStart > currentWeekStart ? (
            <Link
              href={`/student/reservar?date=${previousWeekDate < today ? today : previousWeekDate}${rewardSuffix}`}
              aria-label="Semana anterior"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/20 text-lg text-white transition hover:bg-white/[0.06]"
            >
              ‹
            </Link>
          ) : (
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/5 text-lg text-zinc-700"
            >
              ‹
            </span>
          )}

          <p className="text-center text-xs font-medium capitalize text-zinc-300">
            {shortDate(weekStart)} – {shortDate(weekEnd)}
          </p>

          <Link
            href={`/student/reservar?date=${nextWeekDate}${rewardSuffix}`}
            aria-label="Semana siguiente"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/20 text-lg text-white transition hover:bg-white/[0.06]"
          >
            ›
          </Link>
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {days.map((day) => {
            const chip = dateChip(day);
            const isPast = day < today;
            const isSelected = day === selectedDate;
            const holiday = holidayByDate.get(day);
            const className = `relative rounded-2xl px-1 py-2.5 text-center transition ${
              isSelected
                ? "bg-fuchsia-600 text-white shadow-[0_0_24px_rgba(255,10,138,0.18)]"
                : isPast
                  ? "border border-white/5 bg-black/10 text-zinc-700"
                  : "border border-white/10 bg-black/20 text-zinc-400 hover:border-fuchsia-500/25 hover:text-white"
            }`;
            const holidayTheme = holiday ? getHolidayTheme(holiday.theme_key) : null;
            const holidayClosed = holiday?.operation_mode === "closed";
            const chipStyle =
              holidayTheme && !isSelected
                ? {
                    borderColor: `${holidayTheme.accent}8c`,
                    boxShadow: `inset 0 -14px 18px -12px ${holidayTheme.accent}b3`,
                  }
                : undefined;

            const dateContent = (
              <>
                <span className="block text-[10px] capitalize">{chip.weekday}</span>
                <strong
                  className="mt-0.5 block text-sm"
                  style={
                    holidayClosed && holidayTheme
                      ? {
                          textDecoration: "line-through",
                          textDecorationColor: holidayTheme.accent,
                        }
                      : undefined
                  }
                >
                  {chip.day}
                </strong>
                {holiday && holidayTheme ? (
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[11px] leading-none drop-shadow-[0_0_4px_rgba(0,0,0,0.8)]"
                    style={{ color: holidayTheme.accent }}
                  >
                    {holidayTheme.icon}
                  </span>
                ) : null}
              </>
            );

            return isPast ? (
              <span key={day} className={className} style={chipStyle} aria-disabled="true">
                {dateContent}
              </span>
            ) : (
              <Link
                key={day}
                href={`/student/reservar?date=${day}${rewardSuffix}`}
                aria-current={isSelected ? "date" : undefined}
                aria-label={holiday ? `${chip.weekday} ${chip.day}, ${holiday.name}` : undefined}
                className={className}
                style={chipStyle}
              >
                {dateContent}
              </Link>
            );
          })}
        </div>
      </section>

      {selectedHoliday ? <HolidayNotice holiday={selectedHoliday} /> : null}

      {selectedHoliday?.operation_mode === "closed" ? null : query.error || error ? (
        <section className="rounded-3xl border border-rose-500/25 bg-rose-500/[0.08] p-5 text-center">
          <h2 className="text-base font-semibold text-white">No pudimos cargar las clases</h2>
          <p className="mt-1.5 text-xs leading-5 text-zinc-400">
            Conservamos la fecha seleccionada. Intenta nuevamente.
          </p>
          <Link
            href={`/student/reservar?date=${selectedDate}${rewardSuffix}`}
            className="mt-4 inline-flex min-h-10 items-center justify-center rounded-xl bg-fuchsia-600 px-4 py-2 text-xs font-semibold text-white"
          >
            Intentar de nuevo
          </Link>
        </section>
      ) : (
        <section className="space-y-2.5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Clases del día
              </p>
              <h2 className="mt-0.5 text-base font-semibold capitalize text-white">
                {longDate(selectedDate)}
              </h2>
            </div>
            {items.length ? (
              <span className="text-[10px] text-zinc-600">
                {items.length} {items.length === 1 ? "clase" : "clases"}
              </span>
            ) : null}
          </div>

          {items.length ? (
            items.map((session) => {
              const timeLabel = timeOnly(session.starts_at, studio.timezone);
              const cancelled = session.status === "cancelled";
              const eligible = !cancelled && Boolean(session.eligibility?.eligible);
              const reserved = !cancelled && Boolean(session.is_reserved);
              const waitlisted = waitlistedSessionIds.has(session.session_id);
              const full = session.eligibility?.reason_code === "session_full";
              const style = activityStyleMap.get(session.activity);
              const activityColor = style?.color ?? "#FF0A8A";
              const classDate = localDateKey(new Date(session.starts_at), studio.timezone);
              const eligibilityCopy = bookingReasonCopyForStudent(
                session.eligibility?.reason_code,
                snapshot.acquisitions,
                classDate,
              );
              const needsPayment =
                !cancelled &&
                !reserved &&
                !eligible &&
                session.spots_available > 0 &&
                [
                  "no_active_product",
                  "outside_product",
                  "outside_product_schedule",
                  "no_credits",
                ].includes(session.eligibility?.reason_code ?? "");

              const detailHref = `/student/reservar/${session.session_id}?date=${selectedDate}${rewardSuffix}`;
              const image = disciplineImage(session.activity, session.discipline);
              const motif = disciplineMotif(session.activity, session.discipline);
              const showSpots = !cancelled && !reserved && !waitlisted && !full;
              const fewSpots = session.spots_available <= 2;
              const tileClass =
                "flex min-h-16 min-w-0 items-center justify-center self-stretch rounded-[14px] px-2 text-center text-xs font-bold transition sm:text-sm";

              return (
                <article
                  key={session.session_id}
                  data-density="compact"
                  className={`relative grid items-stretch gap-1.5 overflow-hidden rounded-[18px] border py-[7px] pl-2.5 pr-[7px] transition ${cancelled ? "grid-cols-[minmax(0,1fr)_76px] sm:grid-cols-[minmax(0,1fr)_92px]" : "grid-cols-[minmax(0,1fr)_76px_76px] sm:grid-cols-[minmax(0,1fr)_92px_92px]"}`}
                  style={classAuraStyle(activityColor, { muted: cancelled })}
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute right-2.5 top-0.5 select-none whitespace-nowrap text-lg tracking-[0.25em] opacity-[0.16]"
                  >
                    {`${motif} ✦ ${motif}`}
                  </span>

                  <Link
                    href={detailHref}
                    className="relative grid min-w-0 grid-cols-[46px_minmax(0,1fr)] items-center gap-2.5 self-center py-0.5"
                  >
                    {image ? (
                      <Image
                        src={image}
                        alt=""
                        width={46}
                        height={46}
                        className="h-[46px] w-[46px] rounded-xl border object-cover"
                        style={{ borderColor: `${activityColor}8c` }}
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex h-[46px] w-[46px] items-center justify-center rounded-xl border text-lg text-white"
                        style={{
                          borderColor: `${activityColor}66`,
                          background: `radial-gradient(circle at 45% 25%, ${activityColor}8c, transparent 45%), linear-gradient(145deg, ${activityColor}4d, #090c12 72%)`,
                        }}
                      >
                        ✦
                      </span>
                    )}
                    <span className="min-w-0">
                      <span
                        title={session.activity}
                        className="block truncate text-base font-bold leading-tight text-white"
                      >
                        {session.activity}
                      </span>
                      <span className="block text-xs font-semibold text-zinc-200">{timeLabel}</span>
                      {session.coach ? (
                        <span className="block truncate text-[11px] text-zinc-400">
                          {session.coach}
                        </span>
                      ) : null}
                      <span
                        className="block truncate text-[11px]"
                        style={{ color: cancelled ? "#fda4af" : activityColor }}
                      >
                        {cancelled
                          ? "Cancelada por el estudio"
                          : [session.discipline, session.space || session.location]
                              .filter(Boolean)
                              .join(" · ")}
                      </span>
                    </span>
                  </Link>

                  {showSpots ? (
                    <span
                      className={`relative flex min-h-16 min-w-0 flex-col items-center justify-center self-stretch rounded-[14px] border px-2 text-center ${
                        fewSpots
                          ? "border-amber-300/50 bg-amber-400/[0.14]"
                          : "border-emerald-300/45 bg-emerald-500/[0.14]"
                      }`}
                    >
                      <strong
                        className={`text-[26px] font-extrabold leading-none ${fewSpots ? "text-amber-300" : "text-emerald-300"}`}
                      >
                        {session.spots_available}
                      </strong>
                      <span
                        className={`mt-1 text-[11px] ${fewSpots ? "text-amber-100" : "text-emerald-100"}`}
                      >
                        {session.spots_available === 1 ? "lugar" : "lugares"}
                      </span>
                    </span>
                  ) : (
                    <span
                      className={`relative flex min-h-16 min-w-0 items-center justify-center self-stretch rounded-[14px] border px-2.5 text-center text-xs font-semibold leading-tight ${statusClass(
                        session,
                        waitlisted,
                      )}`}
                    >
                      {cancelled
                        ? "Cancelada"
                        : reserved
                          ? "Reservada"
                          : waitlisted
                            ? "En espera"
                            : "Llena"}
                    </span>
                  )}

                  {cancelled ? null : reserved ? (
                    <Link
                      href={detailHref}
                      className={`${tileClass} relative border border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.08]`}
                    >
                      Ver
                    </Link>
                  ) : eligible && !waitlisted ? (
                    <div className="relative flex min-w-0 self-stretch">
                      <QuickBookButton
                        sessionId={session.session_id}
                        activity={session.activity}
                        discipline={session.discipline}
                        timeLabel={timeLabel}
                        eligible={eligible}
                        reserved={reserved}
                        full={full}
                        waitlisted={waitlisted}
                        levelTitle={levelTitle}
                        requiresResource={session.requires_resource}
                        useRewardCredits={rewardMode}
                        variant="tile"
                      />
                    </div>
                  ) : full || waitlisted ? (
                    <Link
                      href={detailHref}
                      className={`${tileClass} relative border border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.08]`}
                    >
                      {waitlisted ? "Ver lista" : "Espera"}
                    </Link>
                  ) : (
                    <Link
                      href={detailHref}
                      aria-label={`${needsPayment ? "Pagar" : "Ver"} ${session.activity}: ${eligibilityCopy}`}
                      className={`${tileClass} relative border border-fuchsia-500 bg-transparent text-fuchsia-300 hover:bg-fuchsia-500/10`}
                    >
                      {needsPayment ? "Pagar" : "Ver"}
                    </Link>
                  )}
                </article>
              );
            })
          ) : (
            <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-9 text-center">
              <div
                aria-hidden="true"
                className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 text-xl text-zinc-500"
              >
                ◫
              </div>
              <h3 className="mt-3 text-base font-semibold text-white">
                No hay clases para esta fecha
              </h3>
              <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-zinc-400">
                Elige otro día en el calendario para consultar la agenda.
              </p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
