import Link from "next/link";
import StudentPackageCard from "../StudentPackageCard";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { acquisitionStatusCopy, formatDate, formatDateTime, formatMoney } from "../profile-format";
import type { Profile360Model } from "../load-profile-360";
import TransfersSection from "./TransfersSection";

export default function PackagesTab({ model }: { model: Profile360Model }) {
  const {
    can,
    student,
    canReadSales,
    canReadProducts,
    canEditAcquisitions,
    operatingCharges,
    pendingOperatingCharges,
    timeZone,
    locale,
    currency,
    today,
    currentAcquisition,
    scheduledAcquisitions,
    historicalAcquisitions,
    productMap,
    balanceMap,
    packageClassEvents,
    studentSalesHistory,
    historicalValueMinor,
    enrollment,
    enrollmentActive,
  } = model;

  return (
    <div className="p360v2-stack">
      {canReadProducts ? (
        <section id="paquetes-y-creditos" className="profile360-packages-view">
          <div className="profile360-view-heading">
            <div>
              <p className="eyebrow">PAQUETES Y CRÉDITOS</p>
              <h2>Consumo e historial de paquetes</h2>
              <p>
                Revisa exactamente qué ocurrió con cada paquete, sus créditos, clases e incidencias.
              </p>
            </div>
          </div>

          <TransfersSection model={model} />

          {canReadSales ? (
            <div id="penalizaciones" className="profile360-package-group scroll-mt-6">
              <div className="profile360-package-group-heading">
                <strong>Penalizaciones operativas</strong>
                <span>{pendingOperatingCharges.length} pendientes</span>
              </div>

              {(operatingCharges ?? []).length ? (
                <div className="grid gap-3">
                  {(operatingCharges ?? []).map((charge) => {
                    const amount = new Intl.NumberFormat(locale, {
                      style: "currency",
                      currency: charge.currency ?? currency,
                    }).format(Number(charge.amount_minor ?? 0) / 100);
                    const label =
                      charge.charge_type === "late_cancellation" ? "Cancelación tardía" : "No-show";

                    return (
                      <article
                        key={charge.id}
                        className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <strong className="text-sm text-white">{label}</strong>
                            <p className="mt-1 text-xs text-zinc-500">
                              {formatDateTime(charge.created_at, timeZone, locale)}
                            </p>
                            {charge.resolution_note ? (
                              <p className="mt-1 text-xs text-zinc-400">{charge.resolution_note}</p>
                            ) : null}
                          </div>
                          <div className="text-right">
                            <strong className="text-sm text-white">{amount}</strong>
                            <p
                              className={
                                charge.status === "pending"
                                  ? "mt-1 text-xs text-amber-300"
                                  : charge.status === "paid"
                                    ? "mt-1 text-xs text-emerald-300"
                                    : "mt-1 text-xs text-zinc-500"
                              }
                            >
                              {charge.status === "pending"
                                ? "Pendiente"
                                : charge.status === "paid"
                                  ? "Pagada"
                                  : charge.status === "waived"
                                    ? "Condonada"
                                    : "Anulada"}
                            </p>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state">No hay penalizaciones registradas.</div>
              )}
            </div>
          ) : null}

          {currentAcquisition ? (
            <StudentPackageCard
              studentId={student.id}
              kind="current"
              acquisition={{
                id: currentAcquisition.id,
                name: productMap.get(currentAcquisition.product_template_id)?.name ?? "Paquete",
                statusLabel: "Activo",
                startsOn: currentAcquisition.starts_on,
                expiresOn: currentAcquisition.expires_on,
                unlimited: currentAcquisition.unlimited,
                availableCredits: currentAcquisition.unlimited
                  ? null
                  : (balanceMap.get(currentAcquisition.id) ?? 0),
                accessBlocked: currentAcquisition.access_blocked,
                activationMode: currentAcquisition.activation_mode,
              }}
              classes={packageClassEvents.get(currentAcquisition.id) ?? []}
              editable={canEditAcquisitions && !currentAcquisition.refunded_at}
              timeZone={timeZone}
              locale={locale}
            />
          ) : (
            <div className="empty-state">No hay paquete actual.</div>
          )}

          {scheduledAcquisitions.length ? (
            <div className="profile360-package-group">
              <div className="profile360-package-group-heading">
                <strong>Próximos paquetes</strong>
                <span>{scheduledAcquisitions.length}</span>
              </div>
              {scheduledAcquisitions.map((acquisition) => (
                <StudentPackageCard
                  key={acquisition.id}
                  studentId={student.id}
                  kind="scheduled"
                  acquisition={{
                    id: acquisition.id,
                    name: productMap.get(acquisition.product_template_id)?.name ?? "Paquete",
                    statusLabel: "Programado",
                    startsOn: acquisition.starts_on,
                    expiresOn: acquisition.expires_on,
                    unlimited: acquisition.unlimited,
                    availableCredits: acquisition.unlimited
                      ? null
                      : (balanceMap.get(acquisition.id) ?? 0),
                    accessBlocked: acquisition.access_blocked,
                    activationMode: acquisition.activation_mode,
                  }}
                  classes={packageClassEvents.get(acquisition.id) ?? []}
                  editable={false}
                  timeZone={timeZone}
                  locale={locale}
                />
              ))}
            </div>
          ) : null}

          <div className="profile360-package-group">
            <div className="profile360-package-group-heading">
              <strong>Historial de paquetes</strong>
              <span>{historicalAcquisitions.length}</span>
            </div>
            {historicalAcquisitions.length ? (
              historicalAcquisitions.map((acquisition) => {
                const isExpiredByDate =
                  Boolean(acquisition.expires_on) && String(acquisition.expires_on) < today;
                const statusLabel = acquisition.refunded_at
                  ? "Reembolsado"
                  : isExpiredByDate
                    ? "Vencido"
                    : (acquisitionStatusCopy[acquisition.status] ?? "Histórico");
                return (
                  <StudentPackageCard
                    key={acquisition.id}
                    studentId={student.id}
                    kind="historical"
                    acquisition={{
                      id: acquisition.id,
                      name: productMap.get(acquisition.product_template_id)?.name ?? "Paquete",
                      statusLabel,
                      startsOn: acquisition.starts_on,
                      expiresOn: acquisition.expires_on,
                      unlimited: acquisition.unlimited,
                      availableCredits: acquisition.unlimited
                        ? null
                        : (balanceMap.get(acquisition.id) ?? 0),
                      accessBlocked: acquisition.access_blocked,
                      activationMode: acquisition.activation_mode,
                    }}
                    classes={packageClassEvents.get(acquisition.id) ?? []}
                    editable={false}
                    timeZone={timeZone}
                    locale={locale}
                  />
                );
              })
            ) : (
              <div className="empty-state">Todavía no hay paquetes anteriores.</div>
            )}
          </div>
        </section>
      ) : null}
      {canReadSales ? (
        <section id="ventas" className="profile360-view-panel profile360-sales-history scroll-mt-6">
          <div className="profile360-view-heading">
            <div>
              <p className="eyebrow">COMPRAS Y PAGOS</p>
              <h2>Historial de ventas</h2>
              <p>Consulta las compras, pagos y saldos registrados para esta alumna.</p>
            </div>
            {can(CAPABILITIES.SALES_WRITE) && student.lifecycle_status !== "inactive" ? (
              <Link
                className="profile360-sale-history-action"
                href={"/admin/ventas/nueva?student_id=" + student.id}
              >
                + Registrar venta
              </Link>
            ) : null}
          </div>

          <div className="profile360-sales-history-meta">
            <span>{studentSalesHistory.length} ventas</span>
            <span>
              Total pagado:{" "}
              {new Intl.NumberFormat(locale, {
                style: "currency",
                currency,
                maximumFractionDigits: 0,
              }).format(
                studentSalesHistory.reduce((sum, sale) => sum + Math.max(0, sale.netPaidMinor), 0) /
                  100,
              )}
            </span>
          </div>

          {studentSalesHistory.length ? (
            <div className="profile360-sales-list">
              {studentSalesHistory.map((sale) => (
                <Link
                  key={sale.id}
                  href={"/admin/ventas/" + sale.id}
                  className="profile360-sale-row"
                >
                  <span>
                    <strong>{sale.folio}</strong>
                    <small>{formatDateTime(sale.createdAt, timeZone, locale)}</small>
                  </span>
                  <span className="profile360-sale-values">
                    <span>
                      <small>Total</small>
                      <strong>
                        {new Intl.NumberFormat(locale, {
                          style: "currency",
                          currency,
                          maximumFractionDigits: 0,
                        }).format(sale.totalMinor / 100)}
                      </strong>
                    </span>
                    <span>
                      <small>Pagado</small>
                      <strong>
                        {new Intl.NumberFormat(locale, {
                          style: "currency",
                          currency,
                          maximumFractionDigits: 0,
                        }).format(sale.netPaidMinor / 100)}
                      </strong>
                    </span>
                    {sale.balanceMinor > 0 ? (
                      <span>
                        <small>Saldo</small>
                        <strong>
                          {new Intl.NumberFormat(locale, {
                            style: "currency",
                            currency,
                            maximumFractionDigits: 0,
                          }).format(sale.balanceMinor / 100)}
                        </strong>
                      </span>
                    ) : null}
                  </span>
                  <span className="profile360-sale-state">{sale.stateLabel}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-state">Todavía no hay ventas registradas.</div>
          )}
        </section>
      ) : null}
      <section className="crm-card p360v2-enrollment">
        <p className="eyebrow">INSCRIPCIÓN</p>
        <div className="crm-info">
          <span>Estado</span>
          <strong>
            {enrollment ? (enrollmentActive ? "Activa" : "No vigente") : "Sin inscripción"}
          </strong>
        </div>
        <div className="crm-info">
          <span>Vigencia</span>
          <strong>
            {enrollment?.expires_on ? formatDate(enrollment.expires_on, locale) : "Sin registro"}
          </strong>
        </div>
        {historicalValueMinor !== null ? (
          <div className="crm-info">
            <span>Valor histórico</span>
            <strong>{formatMoney(historicalValueMinor, locale, currency)}</strong>
          </div>
        ) : null}
      </section>
    </div>
  );
}
