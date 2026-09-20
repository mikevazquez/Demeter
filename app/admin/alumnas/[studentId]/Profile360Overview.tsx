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
  if (minor === null) return "Sin acceso";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

export default function Profile360Overview({
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
}: Props) {
  const whatsappNumber = student.phone.replace(/\D/g, "");

  return (
    <>
      <section id="resumen" className="profile360-hero">
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
                width={78}
                height={78}
                unoptimized
              />
            ) : null}
          </span>

          <div className="profile360-person-copy">
            <div className="profile360-badges">
              <span
                className={
                  "profile360-state-pill is-" +
                  (student.lifecycleStatus === "inactive" ? "inactive" : "active")
                }
              >
                {student.lifecycleStatus === "inactive" ? "Inactiva" : "Activa"}
              </span>
              <span className="profile360-level-pill">
                {levelTitle ? "Nivel " + levelTitle : "Sin nivel general"}
              </span>
            </div>

            <h1>{student.fullName}</h1>

            <div className="profile360-contact-primary">
              <a href={"tel:" + student.phone}>{student.phone}</a>
              {student.email ? <span>{student.email}</span> : null}
            </div>

            <div className="profile360-inline-actions">
              <a
                href={whatsappNumber ? "https://wa.me/" + whatsappNumber : "#"}
                target={whatsappNumber ? "_blank" : undefined}
                rel={whatsappNumber ? "noreferrer" : undefined}
              >
                WhatsApp
              </a>
              <a href="#datos-personales">Editar datos</a>
            </div>
          </div>
        </div>
      </section>

      <section className="profile360-current-card" aria-label="Estado actual">
        <div className="profile360-current-heading">
          <div>
            <p className="eyebrow">PAQUETE ACTUAL</p>
            <h2>{currentPackage ? currentPackage.name : "Sin paquete activo"}</h2>
          </div>
          {currentPackage ? <span className="status-pill">Activo</span> : null}
        </div>

        {currentPackage ? (
          <>
            <div className="profile360-current-facts">
              <div>
                <strong>
                  {currentPackage.unlimited
                    ? "Ilimitado"
                    : String(currentPackage.availableCredits ?? 0) + " créditos"}
                </strong>
                <span>disponibles</span>
              </div>
              <div>
                <strong>
                  {currentPackage.expiresOn ? formatDate(currentPackage.expiresOn) : "Sin fecha"}
                </strong>
                <span>vencimiento</span>
              </div>
            </div>

            <div className="profile360-next-compact">
              <span>Próxima clase</span>
              {nextClass ? (
                <strong>
                  {nextClass.name} · {formatDateTime(nextClass.startsAt, timeZone)}
                </strong>
              ) : (
                <strong>Sin próxima clase</strong>
              )}
            </div>
          </>
        ) : (
          <p className="profile360-current-empty">
            No hay un paquete vigente para esta alumna.
          </p>
        )}

        {student.lifecycleStatus === "active" && (canBook || canSell) ? (
          <div className="profile360-context-actions">
            {canBook ? (
              <Link
                className="profile360-context-primary"
                href={"/admin/alumnas/" + student.id + "/reservar"}
              >
                Reservar clase
              </Link>
            ) : null}
            {canSell ? (
              <Link
                className="profile360-context-secondary"
                href={"/admin/ventas/nueva?student_id=" + student.id}
              >
                Renovar paquete
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>

      {alerts.length ? (
        <details id="seguimiento" className="profile360-attention">
          <summary>
            <span>
              <strong>Necesita atención</strong>
              <small>
                {alerts[0]?.title}
                {alerts.length > 1 ? " · +" + String(alerts.length - 1) + " más" : ""}
              </small>
            </span>
            <span aria-hidden="true">›</span>
          </summary>
          <div className="profile360-attention-body">
            {alerts.map((alert) => (
              <div className="profile360-alert" key={alert.title + ":" + alert.detail}>
                <strong>{alert.title}</strong>
                <span>{alert.detail}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <details className="profile360-summary-detail">
        <summary>
          <span>
            <strong>Información general</strong>
            <small>Nacimiento, inscripción, valor y Rewards</small>
          </span>
          <span aria-hidden="true">›</span>
        </summary>

        <div className="profile360-mini-summary">
          <div>
            <span>Nacimiento</span>
            <strong>{formatDate(birthDate)}</strong>
          </div>
          <div>
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
          </div>
          <div>
            <span>Valor histórico</span>
            <strong>{formatMoney(historicalValueMinor)}</strong>
          </div>
          <div>
            <span>Rewards</span>
            <strong>
              {rewardsAvailable === null
                ? "Sin acceso"
                : String(rewardsAvailable) + " disponibles"}
            </strong>
          </div>
        </div>
      </details>
    </>
  );
}
