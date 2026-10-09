import Image from "next/image";
import Link from "next/link";
import RenewalPreparation from "../RenewalPreparation";
import {
  channelLabel,
  contactStageLabels,
  renewalRecommended,
  type ContactStage,
} from "@/lib/student-crm";
import type { ContactMessage } from "@/lib/student-crm-conversations";

type Alert = { title: string; detail: string };

type Props = {
  activeView:
    | "conversation"
    | "summary"
    | "packages"
    | "rewards"
    | "evaluations"
    | "documents"
    | "followup"
    | "history"
    | "profile";
  student: {
    id: string;
    userId: string | null;
    fullName: string;
    lifecycleStatus: string;
    phone: string;
    email: string | null;
    createdAt: string;
    portalEntered: boolean;
  };
  stage: ContactStage;
  canEdit: boolean;
  canReadProducts: boolean;
  showRewards: boolean;
  internalNote: string | null;
  messages: ContactMessage[];
  channel?: string;
  birthDate: string | null;
  levelTitle: string | null;
  rewardsAvailable: number | null;
  technicalLevels: Array<{ disciplineName: string; levelTitle: string }>;
  showEvaluations: boolean;
  showDocuments: boolean;
  canSell: boolean;
  currentPackage: {
    name: string;
    priceMinor: number | null;
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
  locale: string;
  currency: string;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}
function formatDate(value: string | null, locale: string) {
  return value
    ? new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(value + "T12:00:00Z"))
    : "Sin vencimiento";
}
function formatDateTime(value: string, timeZone: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
function localDate(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export default function Profile360Overview({
  activeView,
  student,
  stage,
  canEdit,
  canReadProducts,
  showRewards,
  internalNote,
  messages,
  channel,
  birthDate,
  levelTitle,
  rewardsAvailable,
  technicalLevels,
  showEvaluations,
  showDocuments,
  canSell,
  currentPackage,
  nextClass,
  historicalValueMinor,
  enrollment,
  alerts,
  timeZone,
  locale,
  currency,
}: Props) {
  const href = (view: string) => `/admin/alumnas/${student.id}?view=${view}`;
  const today = localDate(timeZone);
  const end = new Date(`${today}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 7);
  const recommended =
    canReadProducts &&
    renewalRecommended(stage, currentPackage?.expiresOn, today, end.toISOString().slice(0, 10));
  const currentEnrollment =
    enrollment?.status === "active" &&
    (!enrollment.startsOn || enrollment.startsOn <= today) &&
    (!enrollment.expiresOn || enrollment.expiresOn >= today);
  const credits = currentPackage?.unlimited
    ? "clases ilimitadas"
    : `${currentPackage?.availableCredits ?? 0} clases disponibles`;
  const progress =
    currentPackage?.creditLimit && !currentPackage.unlimited
      ? Math.min(
          100,
          Math.max(
            0,
            (1 - (currentPackage.availableCredits ?? 0) / currentPackage.creditLimit) * 100,
          ),
        )
      : 0;
  const latest = messages[0];
  const money = (minor: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
  const operationViews = ["packages", "rewards", "evaluations", "documents", "profile"];
  const steps: ContactStage[] = ["prospect", "trial", "student", "former"];
  return (
    <>
      <section className="profile360-approved-header crm-contact-header">
        <Link className="profile360-back crm-back" href="/admin/alumnas">
          ← Contactos
        </Link>
        <div className="profile360-approved-person crm-contact-person">
          <span className="profile360-avatar crm-avatar" aria-hidden="true">
            {initials(student.fullName)}
            {student.userId ? (
              <Image
                src={`/admin/alumnas/${student.id}/avatar`}
                alt=""
                width={50}
                height={50}
                unoptimized
              />
            ) : null}
          </span>
          <div className="profile360-approved-copy">
            <div className="profile360-approved-title">
              <h1>{student.fullName}</h1>
              <span className={`crm-pill is-${stage}`}>{contactStageLabels[stage]}</span>
            </div>
            <div className="profile360-approved-contact">
              <span>{channelLabel(channel)}</span>
              <span>{student.phone}</span>
              {student.email ? <span>{student.email}</span> : null}
              {birthDate ? <span>{formatDate(birthDate, locale)}</span> : null}
            </div>
          </div>
          <div className="crm-head-actions">
            {canEdit ? (
              <Link className="crm-btn" href={href("profile")}>
                Editar datos
              </Link>
            ) : null}
            <Link className="crm-btn" href={href(canReadProducts ? "packages" : "profile")}>
              Operación
            </Link>
          </div>
        </div>
      </section>
      <ol className="crm-steps" aria-label="Etapa actual del contacto">
        {steps.map((item) => (
          <li
            key={item}
            className={stage === item ? "is-current" : ""}
            aria-current={stage === item ? "step" : undefined}
          >
            <span className="crm-step-dot" aria-hidden="true" />
            {contactStageLabels[item]}
          </li>
        ))}
      </ol>
      <nav className="profile360-approved-tabs crm-tabs" aria-label="Perfil 360">
        {[
          {
            view: "summary",
            title: "Resumen",
            active: activeView === "summary" || activeView === "followup",
          },
          { view: "conversation", title: "Conversación", active: activeView === "conversation" },
          {
            view: canReadProducts ? "packages" : "profile",
            title: "Operación",
            active: operationViews.includes(activeView),
          },
          { view: "history", title: "Historial", active: activeView === "history" },
        ].map((tab) => (
          <Link
            key={tab.view}
            className={tab.active ? "is-active" : ""}
            aria-current={tab.active ? "page" : undefined}
            href={href(tab.view)}
          >
            {tab.title}
          </Link>
        ))}
      </nav>
      {operationViews.includes(activeView) ? (
        <nav className="crm-operation-tabs" aria-label="Operación de alumna">
          {canReadProducts ? (
            <Link
              href={href("packages")}
              aria-current={activeView === "packages" ? "page" : undefined}
            >
              Paquetes y créditos
            </Link>
          ) : null}
          {showRewards ? (
            <Link
              href={href("rewards")}
              aria-current={activeView === "rewards" ? "page" : undefined}
            >
              Progreso
            </Link>
          ) : null}
          {showEvaluations ? (
            <Link
              href={href("evaluations")}
              aria-current={activeView === "evaluations" ? "page" : undefined}
            >
              Evaluaciones
            </Link>
          ) : null}
          {showDocuments ? (
            <Link
              href={href("documents")}
              aria-current={activeView === "documents" ? "page" : undefined}
            >
              Documentos
            </Link>
          ) : null}
          <Link href={href("profile")} aria-current={activeView === "profile" ? "page" : undefined}>
            Datos y acceso
          </Link>
        </nav>
      ) : null}
      {activeView === "summary" ? (
        <section className="profile360-approved-summary crm-stack">
          {recommended && currentPackage ? (
            <article className="crm-card crm-recommend">
              <div className="crm-recommend-head">
                <div>
                  <p className="eyebrow">SIGUIENTE PASO RECOMENDADO</p>
                  <h2>Preparar su renovación antes de que venza el paquete</h2>
                </div>
                <span className="crm-pill is-trial">Por vencer</span>
              </div>
              <div className="crm-why">
                <strong>Canal sugerido:</strong>{" "}
                {channelLabel(channel) === "Sin conversación"
                  ? "Por confirmar"
                  : channelLabel(channel)}
                <br />
                <strong>Por qué aparece:</strong> su paquete vence{" "}
                {formatDate(currentPackage.expiresOn, locale)} y tiene {credits}.
              </div>
              <RenewalPreparation
                studentId={student.id}
                name={student.fullName}
                packageName={currentPackage.name}
                expires={formatDate(currentPackage.expiresOn, locale)}
                credits={credits}
                price={currentPackage.priceMinor === null ? null : money(currentPackage.priceMinor)}
                canSell={canSell}
                channel={channelLabel(channel)}
              />
            </article>
          ) : alerts.length ? (
            <article className="crm-card crm-recommend">
              <p className="eyebrow">SIGUIENTE PASO</p>
              <h2>{alerts[0].title}</h2>
              <p className="crm-meta">{alerts[0].detail}</p>
              <Link className="crm-btn" href={href("followup")}>
                Ver seguimiento →
              </Link>
            </article>
          ) : (
            <article className="crm-card">
              <p className="eyebrow">SEGUIMIENTO</p>
              <h2>Sin seguimiento pendiente</h2>
              <p className="crm-meta">
                Consulta su operación e historial para revisar el expediente.
              </p>
            </article>
          )}
          <div className="crm-grid">
            <article className="crm-card">
              <h2>Inscripción</h2>
              <div className="crm-statusline">
                <span>Estado</span>
                <strong>
                  {currentEnrollment ? "Activa" : enrollment ? "No vigente" : "Sin registro"}
                </strong>
              </div>
              <div className="crm-info">
                <span>Vigencia</span>
                <strong>
                  {enrollment
                    ? formatDate(enrollment.expiresOn, locale)
                    : "Sin inscripción registrada"}
                </strong>
              </div>
              {canSell && student.lifecycleStatus !== "inactive" && !currentEnrollment ? (
                <div className="crm-actions">
                  <Link className="crm-btn" href={`/admin/ventas/nueva?student_id=${student.id}`}>
                    Agregar inscripción
                  </Link>
                </div>
              ) : null}
            </article>
            <article className="crm-card profile360-approved-package">
              <h2>Paquete</h2>
              {canReadProducts ? (
                currentPackage ? (
                  <div className="crm-package">
                    <div className="crm-package-title">
                      <strong>{currentPackage.name}</strong>
                      <span className="crm-pill is-student">Activo</span>
                    </div>
                    <p className="crm-meta">
                      {credits} · {formatDate(currentPackage.expiresOn, locale)}
                    </p>
                    {!currentPackage.unlimited && currentPackage.creditLimit ? (
                      <div
                        className="crm-progress"
                        role="meter"
                        aria-label="Créditos consumidos"
                        aria-valuenow={Math.round(progress)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <span style={{ width: `${progress}%` }} />
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="crm-meta">Sin paquete activo</p>
                )
              ) : (
                <p className="crm-meta">Tu rol no permite consultar paquetes.</p>
              )}
              {canSell && student.lifecycleStatus !== "inactive" ? (
                <div className="crm-actions">
                  <Link
                    className="crm-btn is-primary"
                    href={`/admin/ventas/nueva?student_id=${student.id}`}
                  >
                    Vender paquete
                  </Link>
                  {canReadProducts ? (
                    <Link className="crm-btn" href={href(canReadProducts ? "packages" : "profile")}>
                      Ver paquetes
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </article>
          </div>
          <div className="crm-grid">
            <article className="crm-card">
              <h2>Último mensaje</h2>
              {latest ? (
                <>
                  <span className="crm-channel">
                    {channelLabel(latest.channel)} ·{" "}
                    {formatDateTime(latest.createdAt, timeZone, locale)}
                  </span>
                  <p className="crm-message-excerpt">{latest.content}</p>
                </>
              ) : (
                <p className="crm-meta">Sin mensajes disponibles para este contacto.</p>
              )}
              <Link className="crm-btn" href={href("conversation")}>
                Ver conversación
              </Link>
            </article>
            <article className="crm-card">
              <h2>Nota interna</h2>
              <p className="crm-meta">{internalNote || "Sin notas internas registradas."}</p>
              {canEdit ? (
                <Link className="crm-btn" href={href("profile") + "#campos-adicionales"}>
                  Ver datos y notas
                </Link>
              ) : null}
              <h3>Próxima clase</h3>
              <p className="crm-meta">
                {nextClass
                  ? `${nextClass.name} · ${formatDateTime(nextClass.startsAt, timeZone, locale)}`
                  : "Sin próxima clase"}
              </p>
              <h3>Niveles técnicos</h3>
              {showEvaluations && technicalLevels.length ? (
                technicalLevels.map((item) => (
                  <div className="crm-info" key={item.disciplineName}>
                    <span>{item.disciplineName}</span>
                    <strong>{item.levelTitle}</strong>
                  </div>
                ))
              ) : (
                <p className="crm-meta">Sin niveles técnicos disponibles.</p>
              )}
              {showEvaluations ? (
                <Link className="crm-btn" href={href("evaluations")}>
                  Ver evaluaciones
                </Link>
              ) : null}
            </article>
          </div>
          <section className="profile360-approved-indicators crm-summary" aria-label="Estadísticas">
            <article className="crm-stat">
              <span>Compras históricas</span>
              <b>{historicalValueMinor === null ? "—" : money(historicalValueMinor)}</b>
            </article>
            <article className="crm-stat">
              <span>Recompensas disponibles</span>
              <b>{rewardsAvailable ?? "—"}</b>
            </article>
            <article className="crm-stat">
              <span>Medalla</span>
              <b>{levelTitle ? "Medalla " + levelTitle : "Sin medalla"}</b>
            </article>
            <article className="crm-stat">
              <span>Portal</span>
              <b>{student.portalEntered ? "Ingresó" : "Sin ingresar"}</b>
            </article>
          </section>
        </section>
      ) : null}
    </>
  );
}
