import Image from "next/image";
import Link from "next/link";

type Alert = { title: string; detail: string };

type Props = {
  activeView: "summary" | "packages" | "rewards" | "followup" | "history" | "profile";
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

export default function Profile360Overview({
  activeView,
  student,
  birthDate,
  levelTitle,
  rewardsAvailable,
  currentPackage,
  nextClass,
  historicalValueMinor,
  enrollment,
  alerts,
  timeZone,
}: Props) {
  const href = (view: string) => "/admin/alumnas/" + student.id + "?view=" + view;
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
      <section className="profile360-approved-header">
        <Link className="profile360-back" href="/admin/alumnas">← Alumnas</Link>

        <div className="profile360-approved-person">
          <span className="profile360-avatar" aria-hidden="true">
            {initials(student.fullName)}
            {student.userId ? (
              <Image
                src={"/admin/alumnas/" + student.id + "/avatar"}
                alt=""
                width={82}
                height={82}
                unoptimized
              />
            ) : null}
          </span>

          <div className="profile360-approved-copy">
            <div className="profile360-approved-title">
              <h1>{student.fullName}</h1>
            </div>

            <div className="profile360-approved-contact">
              <span>{student.phone}</span>
              {student.email ? <span>{student.email}</span> : null}
              <span>
                {birthDate ? formatDate(birthDate) + " · " : ""}
                En el estudio desde{" "}
                {new Intl.DateTimeFormat("es-MX", {
                  month: "short",
                  year: "numeric",
                }).format(new Date(student.createdAt))}
              </span>
            </div>
          </div>

          <div className="profile360-approved-meta">
            <span className="profile360-level-pill">
              {levelTitle ? "Nivel " + levelTitle : "Sin nivel general"}
            </span>
            <span
              className={
                "profile360-state-pill is-" +
                (student.lifecycleStatus === "inactive" ? "inactive" : "active")
              }
            >
              {student.lifecycleStatus === "inactive" ? "Inactiva" : "Activa"}
            </span>
            <Link className="profile360-edit-link" href={href("profile")}>
              Editar
            </Link>
          </div>
        </div>
      </section>

      <nav className="profile360-approved-tabs" aria-label="Perfil 360">
        <Link className={activeView === "summary" ? "is-active" : ""} href={href("summary")}>
          Resumen
        </Link>
        <Link className={activeView === "packages" ? "is-active" : ""} href={href("packages")}>
          Paquetes
        </Link>
        <Link className={activeView === "rewards" ? "is-active" : ""} href={href("rewards")}>
          Rewards
        </Link>
        <Link className={activeView === "followup" ? "is-active" : ""} href={href("followup")}>
          Seguimiento
        </Link>
        <Link className={activeView === "history" ? "is-active" : ""} href={href("history")}>
          Historial
        </Link>
      </nav>

      {activeView === "summary" ? (
        <div className="profile360-approved-summary">
          <section className="profile360-approved-package">
            <div className="profile360-approved-card-heading">
              <div>
                <p className="eyebrow">PAQUETE ACTUAL</p>
                <h2>{currentPackage ? currentPackage.name : "Sin paquete activo"}</h2>
              </div>
              {currentPackage ? <span className="status-pill">Activo</span> : null}
            </div>

            {currentPackage ? (
              <>
                <div className="profile360-approved-package-row">
                  <div className="profile360-approved-package-balance">
                    <strong>
                      {currentPackage.unlimited
                        ? "Ilimitado"
                        : String(currentPackage.availableCredits ?? 0) +
                          " de " +
                          String(currentPackage.creditLimit ?? 0)}
                    </strong>
                    <span>{currentPackage.unlimited ? "acceso" : "créditos disponibles"}</span>
                  </div>
                  <div className="profile360-approved-package-expiry">
                    <strong>
                      {currentPackage.expiresOn ? formatDate(currentPackage.expiresOn) : "Sin fecha"}
                    </strong>
                    <span>vence</span>
                  </div>
                </div>

                {!currentPackage.unlimited && currentPackage.creditLimit ? (
                  <div className="profile360-approved-progress" aria-hidden="true">
                    <span style={{ width: String(progress) + "%" }} />
                  </div>
                ) : null}

                <div className="profile360-approved-next">
                  <span>Próxima clase</span>
                  <strong>
                    {nextClass
                      ? nextClass.name + " · " + formatDateTime(nextClass.startsAt, timeZone)
                      : "Sin próxima clase"}
                  </strong>
                </div>
              </>
            ) : (
              <p className="profile360-approved-empty">
                Esta alumna no tiene un paquete vigente.
              </p>
            )}
          </section>

          <section className="profile360-approved-indicators" aria-label="Indicadores rápidos">
            <article>
              <span>Valor histórico</span>
              <strong>{formatMoney(historicalValueMinor)}</strong>
            </article>
            <article>
              <span>Recompensas</span>
              <strong>{rewardsAvailable === null ? "—" : rewardsAvailable}</strong>
            </article>
            <article>
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
            </article>
            <article>
              <span>Antigüedad</span>
              <strong>
                {new Intl.DateTimeFormat("es-MX", {
                  month: "short",
                  year: "numeric",
                }).format(new Date(student.createdAt))}
              </strong>
            </article>
          </section>

          {alerts.length ? (
            <section className="profile360-approved-alerts">
              <div className="profile360-approved-card-heading">
                <div>
                  <p className="eyebrow">SEGUIMIENTO Y ALERTAS</p>
                  <h2>Requiere atención</h2>
                </div>
                <span className="count-badge">{alerts.length}</span>
              </div>
              <div className="profile360-approved-alert-list">
                {alerts.slice(0, 3).map((alert) => (
                  <div key={alert.title + alert.detail}>
                    <strong>{alert.title}</strong>
                    <span>{alert.detail}</span>
                  </div>
                ))}
              </div>
              <Link href={href("followup")}>Ver seguimiento →</Link>
            </section>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
