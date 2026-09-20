
import Image from "next/image";
import Link from "next/link";

type Alert = { title: string; detail: string };

type Props = {
  student: {
    id: string;
    userId: string | null;
    fullName: string;
    lifecycleStatus: string;
    phone: string;
    email: string | null;
    createdAt: string;
  };
  birthDate: string | null;
  levelTitle: string | null;
  rewardsAvailable: number | null;
  currentPackage: {
    name: string;
    unlimited: boolean;
    availableCredits: number | null;
    creditLimit: number | null;
    startsOn: string | null;
    expiresOn: string | null;
  } | null;
  nextClass: { name: string; startsAt: string } | null;
  historicalValueMinor: number | null;
  enrollment: {
    status: string;
    startsOn: string | null;
    expiresOn: string | null;
  } | null;
  alerts: Alert[];
  canBook: boolean;
  canSell: boolean;
  timeZone: string;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function formatDate(value: string | null) {
  if (!value) return "Sin registrar";
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value + "T12:00:00Z"));
}

function formatDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMoney(minor: number | null) {
  if (minor === null) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

export default function Profile360Overview(props: Props) {
  const {
    student,
    birthDate,
    levelTitle,
    rewardsAvailable,
    currentPackage,
    nextClass,
    historicalValueMinor,
    enrollment,
    alerts,
    canBook,
    canSell,
    timeZone,
  } = props;

  const whatsappNumber = student.phone.replace(/\D/g, "");
  const usedCredits =
    currentPackage && !currentPackage.unlimited && currentPackage.creditLimit !== null
      ? Math.max(0, currentPackage.creditLimit - (currentPackage.availableCredits ?? 0))
      : null;
  const progress =
    currentPackage &&
    !currentPackage.unlimited &&
    currentPackage.creditLimit &&
    currentPackage.creditLimit > 0 &&
    usedCredits !== null
      ? Math.min(100, Math.max(0, Math.round((usedCredits / currentPackage.creditLimit) * 100)))
      : 0;

  return (
    <>
      <section id="resumen" className="profile360-identity">
        <Link className="profile360-back" href="/admin/alumnas">
          ← Alumnas
        </Link>

        <div className="profile360-person">
          <span className="profile360-avatar" aria-hidden="true">
            {initials(student.fullName)}
            {student.userId ? (
              <Image
                src={"/admin/alumnas/" + student.id + "/avatar"}
                alt=""
                width={86}
                height={86}
                unoptimized
              />
            ) : null}
          </span>

          <div className="profile360-person-copy">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={
                  "profile360-state-pill is-" +
                  (student.lifecycleStatus === "inactive" ? "inactive" : "active")
                }
              >
                {student.lifecycleStatus === "inactive" ? "Inactiva" : "Activa"}
              </span>
              <span className="profile360-level-pill">
                Nivel general · {levelTitle ?? "Sin nivel actual"}
              </span>
            </div>
            <h1>{student.fullName}</h1>
            <div className="profile360-contact">
              <a href={"tel:" + student.phone}>{student.phone}</a>
              <span>{student.email || "Sin correo registrado"}</span>
              <span>
                Nacimiento: {formatDate(birthDate)} · Desde:{" "}
                {new Intl.DateTimeFormat("es-MX", {
                  month: "short",
                  year: "numeric",
                }).format(new Date(student.createdAt))}
              </span>
            </div>
          </div>
        </div>

        <div className="profile360-actions" aria-label="Acciones rápidas">
          <a
            className="profile360-action"
            href={whatsappNumber ? "https://wa.me/" + whatsappNumber : "#"}
            target={whatsappNumber ? "_blank" : undefined}
            rel={whatsappNumber ? "noreferrer" : undefined}
          >
            <strong>◉</strong>
            WhatsApp
          </a>
          {canBook && student.lifecycleStatus === "active" ? (
            <Link className="profile360-action" href={"/admin/alumnas/" + student.id + "/reservar"}>
              <strong>＋</strong>
              Reservar
            </Link>
          ) : (
            <span className="profile360-action" aria-disabled="true">
              <strong>＋</strong>
              Reservar
            </span>
          )}
          {canSell && student.lifecycleStatus === "active" ? (
            <Link
              className="profile360-action"
              href={"/admin/ventas/nueva?student_id=" + student.id}
            >
              <strong>◇</strong>
              Renovar
            </Link>
          ) : (
            <span className="profile360-action" aria-disabled="true">
              <strong>◇</strong>
              Renovar
            </span>
          )}
          <a className="profile360-action" href="#datos-personales">
            <strong>✎</strong>
            Editar
          </a>
        </div>
      </section>

      <nav className="profile360-tabs" aria-label="Secciones del Perfil 360">
        <a className="profile360-tab is-active" href="#resumen">Resumen</a>
        <a className="profile360-tab" href="#paquetes-y-creditos">Paquetes</a>
        <a className="profile360-tab" href="#rewards">Rewards</a>
        <a className="profile360-tab" href="#seguimiento">Seguimiento</a>
        <a className="profile360-tab" href="#historial">Historial</a>
      </nav>

      <div className="profile360-overview-grid">
        <section className="profile360-section">
          <div className="profile360-section-heading">
            <div>
              <p className="eyebrow">PAQUETE ACTUAL</p>
              <h2>Estado operativo</h2>
            </div>
          </div>

          {currentPackage ? (
            <div className="profile360-package-main">
              <div className="profile360-package-title">
                <strong>{currentPackage.name}</strong>
                <span className="status-pill">Activo</span>
              </div>

              {!currentPackage.unlimited && currentPackage.creditLimit !== null ? (
                <div className="profile360-progress">
                  <div className="flex items-center justify-between gap-3 text-xs text-zinc-400">
                    <span>
                      {currentPackage.availableCredits ?? 0} de {currentPackage.creditLimit} créditos
                      disponibles
                    </span>
                    <strong className="text-white">{progress}% usado</strong>
                  </div>
                  <div className="profile360-progress-track" aria-hidden="true">
                    <span style={{ width: String(progress) + "%" }} />
                  </div>
                </div>
              ) : (
                <p className="profile360-package-meta">Créditos ilimitados</p>
              )}

              <p className="profile360-package-meta">
                {currentPackage.startsOn
                  ? "Inició " + formatDate(currentPackage.startsOn)
                  : "Inicio pendiente"}
                {" · "}
                {currentPackage.expiresOn
                  ? "Vence " + formatDate(currentPackage.expiresOn)
                  : "Sin vencimiento calculado"}
              </p>

              <div className="profile360-next-class">
                <span>Próxima clase</span>
                {nextClass ? (
                  <>
                    <strong>{nextClass.name}</strong>
                    <span>{formatDateTime(nextClass.startsAt, timeZone)}</span>
                  </>
                ) : (
                  <strong>Sin próxima clase</strong>
                )}
              </div>
            </div>
          ) : (
            <div className="empty-state">Sin paquete activo.</div>
          )}
        </section>

        {alerts.length ? (
          <section id="seguimiento" className="profile360-alerts">
            <div>
              <p className="eyebrow">SEGUIMIENTO</p>
              <h2 className="m-0 text-base text-white">Necesita atención</h2>
            </div>
            {alerts.map((alert) => (
              <div className="profile360-alert" key={alert.title + ":" + alert.detail}>
                <strong>{alert.title}</strong>
                <span>{alert.detail}</span>
              </div>
            ))}
          </section>
        ) : (
          <section id="seguimiento" className="profile360-section">
            <p className="eyebrow">SEGUIMIENTO</p>
            <h2 className="m-0 text-base text-white">Sin seguimiento pendiente</h2>
            <p className="mt-2 text-sm text-zinc-500">
              No hay situaciones operativas detectadas en este momento.
            </p>
          </section>
        )}
      </div>

      <section className="profile360-metrics" aria-label="Indicadores principales">
        <article className="profile360-metric">
          <span>Valor histórico</span>
          <strong>{formatMoney(historicalValueMinor)}</strong>
          <small className="text-zinc-500">Pagos netos confirmados</small>
        </article>
        <article id="rewards" className="profile360-metric">
          <span>Nivel general</span>
          <strong>{levelTitle ?? "Sin nivel"}</strong>
          <small className="text-zinc-500">
            {rewardsAvailable === null
              ? "Rewards no disponible para este rol"
              : String(rewardsAvailable) +
                " recompensa" +
                (rewardsAvailable === 1 ? "" : "s") +
                " disponible" +
                (rewardsAvailable === 1 ? "" : "s")}
          </small>
        </article>
        <article className="profile360-metric">
          <span>Inscripción</span>
          <strong>
            {enrollment?.status === "active"
              ? enrollment.expiresOn
                ? "Vigente"
                : "Vitalicia"
              : enrollment
                ? "No vigente"
                : "Sin registro"}
          </strong>
          <small className="text-zinc-500">
            {enrollment?.expiresOn
              ? "Hasta " + formatDate(enrollment.expiresOn)
              : enrollment?.startsOn
                ? "Desde " + formatDate(enrollment.startsOn)
                : "—"}
          </small>
        </article>
        <article className="profile360-metric">
          <span>Antigüedad</span>
          <strong>
            {new Intl.DateTimeFormat("es-MX", {
              month: "short",
              year: "numeric",
            }).format(new Date(student.createdAt))}
          </strong>
          <small className="text-zinc-500">Alta en el estudio</small>
        </article>
      </section>
    </>
  );
}
