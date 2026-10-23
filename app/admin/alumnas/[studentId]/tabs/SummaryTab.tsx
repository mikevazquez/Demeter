import Link from "next/link";

import RenewalPreparation from "../../RenewalPreparation";
import { channelLabel } from "@/lib/student-crm";
import type { Profile360Model } from "../load-profile-360";
import { formatDate, formatDateTime, formatMoney } from "../profile-format";
import { profileTabHref } from "../profile-tabs";

/** P360-V2-02 · Lo que hay que hacer hoy con la persona, su paquete y su próxima clase. */
export default function SummaryTab({ model }: { model: Profile360Model }) {
  const {
    student,
    pendingItems,
    currentPackageView: pkg,
    nextClass,
    enrollment,
    enrollmentActive,
    internalNote,
    canReadProducts,
    canSell,
    communications,
    timeZone,
    locale,
    currency,
  } = model;
  const left = pkg?.unlimited
    ? "clases ilimitadas"
    : `${pkg?.availableCredits ?? 0} ${pkg?.availableCredits === 1 ? "clase" : "clases"}`;
  const used =
    pkg && !pkg.unlimited && pkg.creditLimit
      ? Math.min(100, Math.max(0, (1 - (pkg.availableCredits ?? 0) / pkg.creditLimit) * 100))
      : null;

  return (
    <div className="p360v2-stack">
      <div className="p360v2-section-title">
        <h2>Pendientes</h2>
        <span>{pendingItems.length ? pendingItems.length : "Ninguno"}</span>
      </div>

      {pendingItems.length ? (
        <ul className="p360v2-pending" aria-label="Pendientes">
          {pendingItems.map((item) => (
            <li key={item.key} className={`p360v2-task is-${item.tone}`}>
              <span className="p360v2-task-bar" aria-hidden="true" />
              <div className="p360v2-task-body">
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
                {item.key === "renewal" && pkg ? (
                  <RenewalPreparation
                    studentId={student.id}
                    name={student.full_name}
                    packageName={pkg.name}
                    expires={pkg.expiresOn ? formatDate(pkg.expiresOn, locale) : "Sin vencimiento"}
                    credits={left}
                    price={
                      pkg.priceMinor === null
                        ? null
                        : formatMoney(pkg.priceMinor, locale, currency, 2)
                    }
                    canSell={canSell}
                    channel={channelLabel(communications.channels.get(student.id))}
                  />
                ) : null}
                {item.actions.length ? (
                  <div className="p360v2-task-actions">
                    {item.actions.map((action) => (
                      <Link
                        key={action.href + action.label}
                        className={`crm-btn${action.primary ? " is-primary" : ""}`}
                        href={action.href}
                      >
                        {action.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p360v2-clear">Al día. No hay nada pendiente con ella.</p>
      )}

      {canReadProducts ? (
        <section className="crm-card p360v2-package">
          <div className="p360v2-row">
            <p className="eyebrow">PAQUETE ACTUAL</p>
            {pkg ? <span className="crm-pill is-student">Activo</span> : null}
          </div>
          {pkg ? (
            <>
              <h2>{pkg.name}</h2>
              {used !== null ? (
                <div
                  className="crm-progress"
                  role="meter"
                  aria-label="Clases usadas"
                  aria-valuenow={Math.round(used)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span style={{ width: `${used}%` }} />
                </div>
              ) : null}
              <p className="crm-meta p360v2-numbers">
                <strong>{left}</strong>
                {pkg.unlimited ? null : pkg.creditLimit ? ` de ${pkg.creditLimit}` : null} · vence{" "}
                {pkg.expiresOn ? formatDate(pkg.expiresOn, locale) : "sin fecha"}
              </p>
            </>
          ) : (
            <p className="crm-meta">Sin paquete activo.</p>
          )}
          <Link className="crm-btn" href={profileTabHref(student.id, "packages")}>
            Ver historial y pagos
          </Link>
        </section>
      ) : null}

      <section className="crm-card">
        <div className="crm-info">
          <span>Próxima clase</span>
          <strong>
            {nextClass
              ? `${nextClass.name} · ${formatDateTime(nextClass.startsAt, timeZone, locale)}`
              : "Sin clase reservada"}
          </strong>
        </div>
        <div className="crm-info">
          <span>Inscripción</span>
          <strong>
            {enrollment
              ? `${enrollmentActive ? "Activa" : "Vencida"}${
                  enrollment.expires_on
                    ? ` · vence ${formatDate(enrollment.expires_on, locale)}`
                    : ""
                }`
              : "Sin inscripción"}
          </strong>
        </div>
        <div className="crm-info">
          <span>Nota interna</span>
          <strong>{internalNote || "Sin nota"}</strong>
        </div>
        {canSell && !enrollment && student.lifecycle_status !== "inactive" ? (
          <div className="p360v2-task-actions">
            <Link className="crm-btn" href={`/admin/ventas/nueva?student_id=${student.id}`}>
              Agregar inscripción
            </Link>
          </div>
        ) : null}
      </section>
    </div>
  );
}
