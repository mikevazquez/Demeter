"use client";

import { CaretDown } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { SessionOperations } from "./SessionOperations";

export type TodayRosterItem = {
  id: string;
  studentName: string;
  status: string;
  packageLabel: string;
  creditsLabel: string;
  expiresLabel: string;
  studentId?: string | null;
  evaluationInvitationId?: string | null;
  evaluationStatus?: string | null;
  attendanceSource?: string | null;
  checkedInAt?: string | null;
  attendanceProvenance?: string | null;
  paymentDueOnAttendance?: boolean;
  pendingPackageSaleId?: string;
  pendingPackageAmountMinor?: number;
  individualPriceMinor?: number | null;
  currency?: string;
  resourceName?: string | null;
  resourceRequired?: boolean;
};

export type TodayClassItem = {
  id: string;
  time: string;
  startsAt: string;
  endsAt: string;
  name: string;
  instructor: string;
  space: string;
  occupied: number;
  bookedReservations: number;
  capacity: number;
  color: string;
  sessionStatus: string;
  cancellationReason?: string | null;
  cancelledAt?: string | null;
  cancelledByLabel?: string | null;
  cancellationSource?: string | null;
  roster: TodayRosterItem[];
  available: number;
  evaluationCount: number;
  returnTo: string;
  minimumReservationsEnabled: boolean;
  minimumReservations: number;
  minimumReviewStatus: string;
};

type TodayClassesProps = {
  classes: TodayClassItem[];
  returnDate: string;
  canAttendance: boolean;
  canBook: boolean;
  canCreateStudent: boolean;
  canCollectPayment?: boolean;
  operatingPolicy?: {
    noShowConsumesCredit: boolean;
    cancellationCutoffMinutes: number;
    lateCancellationConsumesCredit: boolean;
  };
  locale: string;
  timeZone: string;
  canCorrectCompleted?: boolean;
  serverNow: string;
};

export function TodayClasses({
  classes,
  returnDate,
  canAttendance,
  canBook,
  canCreateStudent,
  canCollectPayment = true,
  operatingPolicy,
  locale,
  timeZone,
  canCorrectCompleted = true,
  serverNow,
}: TodayClassesProps) {
  const router = useRouter();
  const initialNow = useMemo(() => new Date(serverNow).getTime(), [serverNow]);
  const [now, setNow] = useState(initialNow);
  const effectiveNow = Math.max(now, initialNow);

  useEffect(() => {
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      setNow(initialNow + (Date.now() - startedAt));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [initialNow]);

  const hasLiveOrClosingSession = classes.some((item) => {
    if (item.sessionStatus !== "scheduled") return false;
    return effectiveNow >= new Date(item.startsAt).getTime();
  });

  useEffect(() => {
    if (!hasLiveOrClosingSession) return;
    const interval = window.setInterval(() => router.refresh(), 8000);
    return () => window.clearInterval(interval);
  }, [hasLiveOrClosingSession, router]);

  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => {
      const id = window.location.hash.replace("#session-", "");
      if (classes.some((item) => item.id === id)) {
        setOpenSessionId(id);
        window.requestAnimationFrame(() =>
          document
            .getElementById(`class-${id}`)
            ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        );
      }
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [classes]);

  if (!classes.length) {
    return <div className="today-empty-state">No hay clases programadas para este día.</div>;
  }

  const renderClass = (item: TodayClassItem) => {
    const isOpen = openSessionId === item.id;
    const startsAt = new Date(item.startsAt).getTime();
    const endsAt = new Date(item.endsAt).getTime();
    const phase =
      item.sessionStatus === "cancelled"
        ? "cancelled"
        : item.sessionStatus === "completed"
          ? "finished"
          : effectiveNow < startsAt
            ? "upcoming"
            : effectiveNow < endsAt
              ? "live"
              : "closing";
    const phaseLabel =
      phase === "cancelled"
        ? "Cancelada"
        : phase === "finished"
          ? "Finalizada"
          : phase === "live"
            ? "En curso"
            : phase === "closing"
              ? "Finalizada"
              : returnDate ===
                  new Intl.DateTimeFormat("en-CA", {
                    timeZone,
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                  }).format(new Date(effectiveNow))
                ? startsAt - effectiveNow >= 3600000
                  ? `en ${Math.ceil((startsAt - effectiveNow) / 3600000)} h`
                  : `en ${Math.ceil((startsAt - effectiveNow) / 60000)} min`
                : "";
    const remainingMs = Math.max(endsAt - effectiveNow, 0);
    const remainingSeconds = Math.floor(remainingMs / 1000);
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = remainingSeconds % 60;
    const remainingLabel = [hours, minutes, seconds]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");

    return (
      <article
        className={`today-class-card${isOpen ? " is-open" : ""}`}
        id={`class-${item.id}`}
        key={item.id}
        style={{ "--class-accent": item.color } as React.CSSProperties}
      >
        <button
          className="today-class-summary"
          type="button"
          onClick={() => {
            const next = isOpen ? null : item.id;
            setOpenSessionId(next);
            const url = new URL(window.location.href);
            url.hash = next ? `session-${next}` : "";
            window.history.replaceState(null, "", url.toString());
          }}
          aria-expanded={isOpen}
          aria-controls={`session-${item.id}`}
        >
          <span className="today-class-accent" aria-hidden="true" />
          <span className="today-class-time">
            <b>
              {new Intl.DateTimeFormat(locale, {
                timeZone,
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              })
                .formatToParts(new Date(item.startsAt))
                .filter((part) => ["hour", "literal", "minute"].includes(part.type))
                .map((part) => part.value)
                .join("")
                .trim()}
            </b>
            <small>
              {
                new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", hour12: true })
                  .formatToParts(new Date(item.startsAt))
                  .find((part) => part.type === "dayPeriod")?.value
              }
            </small>
          </span>
          <span className="today-class-copy">
            <strong>{item.name}</strong>
            <small className="today-class-meta">
              {phase === "cancelled"
                ? (item.cancellationReason ?? "Clase cancelada por el estudio")
                : phase === "finished" || phase === "closing"
                  ? [
                      `${item.roster.filter((person) => person.status === "attended").length} asistieron`,
                      ...(item.roster.some((person) => person.status === "no_show")
                        ? [
                            `${item.roster.filter((person) => person.status === "no_show").length} no show`,
                          ]
                        : []),
                      ...(item.roster.some((person) => person.status === "reserved")
                        ? [
                            `${item.roster.filter((person) => person.status === "reserved").length} sin marcar`,
                          ]
                        : []),
                    ].join(" · ")
                  : `${item.bookedReservations} ${item.bookedReservations === 1 ? "reservada" : "reservadas"} · ${item.instructor}`}
            </small>
            <span className="today-class-state-row">
              {phaseLabel ? (
                <span className={`today-class-state is-${phase}`}>{phaseLabel}</span>
              ) : null}
              {item.occupied >= item.capacity && ["upcoming", "live"].includes(phase) ? (
                <span className="flow-full">Llena</span>
              ) : null}
              {item.minimumReservationsEnabled &&
              item.minimumReviewStatus === "pending" &&
              item.bookedReservations < item.minimumReservations ? (
                <span className="flow-minimum">
                  Faltan {item.minimumReservations - item.bookedReservations} para el mínimo
                </span>
              ) : null}
              {phase === "live" ? (
                <span className="today-class-countdown" aria-label="Tiempo restante">
                  ◷ {remainingLabel}
                </span>
              ) : null}
            </span>
            {item.evaluationCount > 0 ? (
              <small className="today-class-evaluation-summary">
                {item.evaluationCount}{" "}
                {item.evaluationCount === 1 ? "evaluación programada" : "evaluaciones programadas"}
              </small>
            ) : null}
          </span>
          <span className="today-class-capacity">
            <b>
              {item.occupied}/{item.capacity}
            </b>
            <small>lugares</small>
            <span className="flow-capacity-meter" aria-hidden="true">
              <i
                style={{
                  width: `${Math.min(100, item.capacity ? (item.occupied / item.capacity) * 100 : 0)}%`,
                }}
              />
            </span>
            {item.minimumReservationsEnabled ? (
              <small className="today-class-minimum-badge">Mín. {item.minimumReservations}</small>
            ) : null}
          </span>
          <span className="today-class-chevron" aria-hidden="true">
            <CaretDown size={18} style={{ transform: isOpen ? "rotate(180deg)" : undefined }} />
          </span>
        </button>

        {isOpen && phase === "cancelled" ? (
          <div className="flow-cancel-reason">
            <strong>Motivo: {item.cancellationReason ?? "No registrado"}</strong>
            <p>Las reservas se cancelaron y las clases se devolvieron a cada paquete.</p>
            <p>
              {item.cancelledAt
                ? `Canceló ${item.cancelledByLabel ?? "Equipo del estudio"} · ${new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(item.cancelledAt))}`
                : "No hay registro de autor o fecha para esta cancelación anterior."}
            </p>
            <a href={`/admin/agenda/${item.id}`}>Ver detalle de la sesión</a>
          </div>
        ) : isOpen ? (
          <SessionOperations
            sessionId={item.id}
            returnDate={returnDate}
            sessionStatus={item.sessionStatus}
            startsAt={item.startsAt}
            endsAt={item.endsAt}
            roster={item.roster}
            available={item.available}
            canAttendance={canAttendance}
            canBook={canBook}
            canCreateStudent={canCreateStudent}
            canCollectPayment={canCollectPayment}
            operatingPolicy={operatingPolicy}
            locale={locale}
            timeZone={timeZone}
            canCorrectCompleted={canCorrectCompleted}
            returnTo={item.returnTo}
            initiallyOpen
            showToggle={false}
          />
        ) : null}
      </article>
    );
  };
  const active = classes.filter((item) => item.sessionStatus !== "cancelled");
  const cancelled = classes.filter((item) => item.sessionStatus === "cancelled");
  return (
    <div className="today-class-list">
      {active.map(renderClass)}
      {cancelled.length ? (
        <details
          className="flow-cancelled"
          open={!active.length || cancelled.some((item) => item.id === openSessionId)}
        >
          <summary>
            ✕ {cancelled.length} clase(s) cancelada(s) ·{" "}
            {cancelled.map((item) => item.time).join(", ")}
          </summary>
          {cancelled.map(renderClass)}
        </details>
      ) : null}
    </div>
  );
}
