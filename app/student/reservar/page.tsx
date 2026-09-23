import Link from "next/link";

import {
  bookingReasonCopy,
  getStudentPortalContext,
  localDateKey,
  type StudentSession,
} from "@/lib/student/portal";

import PurchaseSingleClassButton from "./PurchaseSingleClassButton";
import { QuickBookButton } from "./quick-book-button";
import { BookingRestrictionCard } from "./BookingRestrictionCard";

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

function statusClass(session: StudentSession, waitlisted = false) {
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

function statusCopy(session: StudentSession, waitlisted = false) {
  if (session.is_reserved) return "Ya reservada";
  if (waitlisted) return "En lista de espera";
  if (session.eligibility?.eligible) return "Disponible";
  return bookingReasonCopy(session.eligibility?.reason_code);
}

export default async function StudentReservePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string }>;
}) {
  const query = await searchParams;
  const { supabase, studio, membership } = await getStudentPortalContext();
  const { data: globalRestrictionData } = await supabase.rpc(
    "student_booking_restrictions_snapshot",
    { p_session_id: null },
  );
  const globalRestrictions = (globalRestrictionData ?? []) as NonNullable<
    StudentSession["eligibility"]["restrictions"]
  >;

  const today = localDateKey(new Date(), studio.timezone);
  const requestedDate = safeDate(query.date, today);
  const selectedDate = requestedDate < today ? today : requestedDate;
  const weekStart = startOfWeek(selectedDate);
  const currentWeekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const previousWeekDate = addDays(selectedDate, -7);
  const nextWeekDate = addDays(selectedDate, 7);

  const { data: sessions, error } = await supabase.rpc("student_schedule_feed", {
    target_start: selectedDate,
    target_end: selectedDate,
    target_discipline_id: null,
  });

  const baseItems = (sessions ?? []) as StudentSession[];
  const sessionIds = baseItems.map((item) => item.session_id);
  const { data: resourceRequirements } = sessionIds.length
    ? await supabase
        .from("class_sessions")
        .select("id,requires_resource")
        .eq("studio_id", membership.studio_id)
        .in("id", sessionIds)
    : { data: [] as { id: string; requires_resource: boolean }[] };
  const resourceRequirementMap = new Map(
    (resourceRequirements ?? []).map((item) => [item.id, item.requires_resource]),
  );
  const items = baseItems.map((item) => ({
    ...item,
    requires_resource: resourceRequirementMap.get(item.session_id) ?? false,
  }));

  const [{ data: waitlistData }, { data: rewardStatusData }] = await Promise.all([
    supabase.rpc("student_waitlist_feed"),
    supabase.rpc("student_reward_status_snapshot"),
  ]);
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
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
          Portal alumna
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">Reservar clase</h1>
        <p className="mt-1.5 text-xs leading-5 text-zinc-400">
          Elige una fecha para ver todas las clases disponibles de ese día.
        </p>
      </header>

      {globalRestrictions.length ? (
        <BookingRestrictionCard
          restrictions={globalRestrictions}
          returnTo={`/student/reservar?date=${selectedDate}`}
        />
      ) : null}

      <section
        aria-label="Seleccionar fecha"
        className="rounded-3xl border border-white/10 bg-white/[0.03] p-3 sm:p-4"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          {weekStart > currentWeekStart ? (
            <Link
              href={`/student/reservar?date=${previousWeekDate < today ? today : previousWeekDate}`}
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
            href={`/student/reservar?date=${nextWeekDate}`}
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
            const className = `rounded-2xl px-1 py-2.5 text-center transition ${
              isSelected
                ? "bg-fuchsia-600 text-white shadow-[0_0_24px_rgba(255,10,138,0.18)]"
                : isPast
                  ? "border border-white/5 bg-black/10 text-zinc-700"
                  : "border border-white/10 bg-black/20 text-zinc-400 hover:border-fuchsia-500/25 hover:text-white"
            }`;

            const dateContent = (
              <>
                <span className="block text-[10px] capitalize">{chip.weekday}</span>
                <strong className="mt-0.5 block text-sm">{chip.day}</strong>
              </>
            );

            return isPast ? (
              <span key={day} className={className} aria-disabled="true">
                {dateContent}
              </span>
            ) : (
              <Link
                key={day}
                href={`/student/reservar?date=${day}`}
                aria-current={isSelected ? "date" : undefined}
                className={className}
              >
                {dateContent}
              </Link>
            );
          })}
        </div>
      </section>

      {query.error || error ? (
        <section className="rounded-3xl border border-rose-500/25 bg-rose-500/[0.08] p-5 text-center">
          <h2 className="text-base font-semibold text-white">No pudimos cargar las clases</h2>
          <p className="mt-1.5 text-xs leading-5 text-zinc-400">
            Conservamos la fecha seleccionada. Intenta nuevamente.
          </p>
          <Link
            href={`/student/reservar?date=${selectedDate}`}
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
              const eligible = Boolean(session.eligibility?.eligible);
              const reserved = Boolean(session.is_reserved);
              const waitlisted = waitlistedSessionIds.has(session.session_id);
              const full = session.eligibility?.reason_code === "session_full";
              const style = activityStyleMap.get(session.activity);
              const activityColor = style?.color ?? "#FF0A8A";
              const dropInPriceMinor = style?.dropInPriceMinor ?? null;
              const canBuySingleClass =
                !reserved &&
                !eligible &&
                session.spots_available > 0 &&
                dropInPriceMinor != null &&
                ["no_active_product", "outside_product", "no_credits"].includes(
                  session.eligibility?.reason_code ?? "",
                );

              return (
                <article
                  key={session.session_id}
                  data-density="compact"
                  className="rounded-2xl border border-white/10 bg-black/20 p-3 transition hover:bg-white/[0.045]"
                  style={{ borderLeftColor: activityColor, borderLeftWidth: 3 }}
                >
                  <div className="grid grid-cols-[4.25rem_1fr_auto] items-center gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{timeLabel}</p>
                      <p className="mt-0.5 text-[10px] text-zinc-600">
                        {Math.max(session.capacity - session.spots_available, 0)}/{session.capacity}{" "}
                        reservados
                      </p>
                    </div>

                    <Link
                      href={`/student/reservar/${session.session_id}?date=${selectedDate}`}
                      className="min-w-0 border-l border-white/10 pl-3"
                    >
                      <p className="truncate text-sm font-semibold text-white">
                        {session.activity}
                      </p>
                      <p className="mt-0.5 truncate text-[11px]" style={{ color: activityColor }}>
                        {session.discipline}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                        {[session.coach, session.space || session.location]
                          .filter(Boolean)
                          .join(" · ") || "Ver detalle"}
                      </p>
                    </Link>

                    <Link
                      href={`/student/reservar/${session.session_id}?date=${selectedDate}`}
                      aria-label={`Ver detalles de ${session.activity}`}
                      className="flex items-center gap-2"
                    >
                      <span
                        className={`hidden rounded-full border px-2 py-1 text-[10px] font-semibold sm:inline-flex ${statusClass(
                          session,
                          waitlisted,
                        )}`}
                      >
                        {statusCopy(session, waitlisted)}
                      </span>
                      <span aria-hidden="true" className="text-xl text-zinc-500">
                        ›
                      </span>
                    </Link>
                  </div>

                  <div className="mt-3 border-t border-white/10 pt-3">
                    {canBuySingleClass ? (
                      <div>
                        <div>
                          <p className="text-[11px] font-semibold text-amber-100">
                            Esta clase no está incluida en tu paquete
                          </p>
                          <p className="mt-0.5 text-[10px] text-zinc-500">
                            Clase suelta ·{" "}
                            {new Intl.NumberFormat("es-MX", {
                              style: "currency",
                              currency: "MXN",
                              maximumFractionDigits: 0,
                            }).format((dropInPriceMinor ?? 0) / 100)}
                          </p>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                          <Link
                            href="/student/paquete"
                            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white"
                          >
                            Ver paquetes
                          </Link>
                          <PurchaseSingleClassButton
                            sessionId={session.session_id}
                            priceLabel={new Intl.NumberFormat("es-MX", {
                              style: "currency",
                              currency: "MXN",
                              maximumFractionDigits: 0,
                            }).format((dropInPriceMinor ?? 0) / 100)}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-end">
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
                        />
                      </div>
                    )}
                  </div>
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
                No hay clases disponibles para esta fecha
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
