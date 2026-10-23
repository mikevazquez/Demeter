import Link from "next/link";
import PendingActionButton from "@/app/admin/components/PendingActionButton";
import StudentPackageCard from "../StudentPackageCard";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { reviewStudentTransferPurchaseAction } from "../actions";
import { acquisitionStatusCopy, formatDate, formatDateTime, formatMoney } from "../profile-format";
import type { Profile360Model } from "../load-profile-360";

export default function PackagesTab({ model }: { model: Profile360Model }) {
  const {
    can,
    student,
    canReadSales,
    canManageSales,
    canReadProducts,
    canEditAcquisitions,
    operatingCharges,
    pendingOperatingCharges,
    transferPurchaseRows,
    groupReceiptReviews,
    groupReceiptUrlMap,
    transferReceiptUrlMap,
    pendingTransferReviews,
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

          {canReadSales ? (
            <div id="transferencias" className="profile360-package-group scroll-mt-6">
              <div className="profile360-package-group-heading">
                <strong>Pagos por transferencia</strong>
                <span>
                  {pendingTransferReviews.length
                    ? `${pendingTransferReviews.length} pendiente${
                        pendingTransferReviews.length === 1 ? "" : "s"
                      }`
                    : "Sin pendientes"}
                </span>
              </div>

              {transferPurchaseRows.length ? (
                <div className="grid gap-3">
                  {transferPurchaseRows.map((item) => {
                    const groupReview = groupReceiptReviews.byIntent.get(item.id);
                    const amount = new Intl.NumberFormat(locale, {
                      style: "currency",
                      currency: item.currency ?? currency,
                    }).format(Number(item.amount_minor ?? 0) / 100);
                    const packageName = productMap.get(item.product_template_id)?.name ?? "Paquete";
                    const statusLabel =
                      item.status === "provisional_active"
                        ? "Pendiente de validar"
                        : item.status === "validated"
                          ? "Validada"
                          : item.status === "rejected"
                            ? "Rechazada"
                            : item.status === "awaiting_receipt"
                              ? "Esperando comprobante"
                              : item.status === "cancelled"
                                ? "Cancelada"
                                : item.status === "expired"
                                  ? "Vencida"
                                  : item.status;
                    const eventAt =
                      item.receipt_received_at ??
                      item.validated_at ??
                      item.rejected_at ??
                      item.created_at;

                    return (
                      <article
                        key={item.id}
                        className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <strong className="text-sm text-white">{packageName}</strong>
                            <p className="mt-1 text-xs text-zinc-400">{amount}</p>
                            <p className="mt-1 text-xs text-zinc-500">
                              {item.receipt_received_at
                                ? "Comprobante recibido · "
                                : "Solicitud creada · "}
                              {formatDateTime(eventAt, timeZone, locale)}
                            </p>
                            {item.review_note ? (
                              <p className="mt-2 text-xs text-zinc-400">{item.review_note}</p>
                            ) : null}
                            {!groupReceiptReviews.available ? (
                              <p className="mt-3 text-xs text-amber-300">
                                No se pudo cargar toda la evidencia. Vuelve a intentarlo antes de
                                validar.
                              </p>
                            ) : groupReview ? (
                              <div className="mt-3 rounded-2xl border border-white/10 p-3">
                                <p className="text-xs text-zinc-300">
                                  Comprobantes del grupo · Total:{" "}
                                  {new Intl.NumberFormat(locale, {
                                    style: "currency",
                                    currency: groupReview.currency,
                                  }).format(groupReview.amountMinor / 100)}
                                  . Esta compra tiene asignados {amount}. Revisa todos los
                                  documentos.
                                </p>
                                <ul className="mt-2 grid gap-2">
                                  {groupReview.documents.map((document, index) => (
                                    <li key={document.id} className="text-xs text-zinc-400">
                                      Documento {index + 1}:{" "}
                                      {document.amountMinor == null
                                        ? "Importe ilegible"
                                        : new Intl.NumberFormat(locale, {
                                            style: "currency",
                                            currency: groupReview.currency,
                                          }).format(document.amountMinor / 100)}
                                      {" · "}
                                      {document.status === "received"
                                        ? "Recibido"
                                        : document.status === "unreadable"
                                          ? "Ilegible"
                                          : "Importe o moneda no coincide"}
                                      {groupReceiptUrlMap.get(document.path) ? (
                                        <a
                                          href={groupReceiptUrlMap.get(document.path)}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="ml-2 font-semibold text-fuchsia-300"
                                        >
                                          Abrir comprobante
                                        </a>
                                      ) : (
                                        <span className="ml-2 text-amber-300">
                                          Archivo no disponible
                                        </span>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : transferReceiptUrlMap.get(item.id) ? (
                              <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                                <iframe
                                  title={`Comprobante de transferencia de ${packageName}`}
                                  src={transferReceiptUrlMap.get(item.id)}
                                  className="h-72 w-full bg-white"
                                />
                                <div className="flex items-center justify-between gap-3 px-3 py-2">
                                  <span className="text-[11px] text-zinc-500">
                                    Comprobante guardado de forma privada
                                  </span>
                                  <a
                                    href={transferReceiptUrlMap.get(item.id)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs font-semibold text-fuchsia-300 hover:text-fuchsia-200"
                                  >
                                    Abrir
                                  </a>
                                </div>
                              </div>
                            ) : item.receipt_received_at ? (
                              <p className="mt-3 text-xs text-amber-300">
                                Comprobante recibido; el archivo todavía no está disponible para
                                vista.
                              </p>
                            ) : null}
                          </div>
                          <span
                            className={
                              item.status === "validated"
                                ? "text-xs font-semibold text-emerald-300"
                                : item.status === "provisional_active"
                                  ? "text-xs font-semibold text-amber-300"
                                  : item.status === "rejected"
                                    ? "text-xs font-semibold text-rose-300"
                                    : "text-xs font-semibold text-zinc-400"
                            }
                          >
                            {statusLabel}
                          </span>
                        </div>

                        {item.status === "provisional_active" &&
                        canManageSales &&
                        groupReceiptReviews.available &&
                        (!groupReview ||
                          (groupReview.documents.length > 0 &&
                            groupReview.documents.every((d) => groupReceiptUrlMap.has(d.path)))) ? (
                          <form
                            action={reviewStudentTransferPurchaseAction}
                            className="mt-4 flex flex-wrap gap-2"
                          >
                            <input type="hidden" name="student_id" value={student.id} />
                            <input type="hidden" name="intent_id" value={item.id} />
                            <PendingActionButton
                              name="decision"
                              value="approved"
                              pendingLabel="Validando…"
                              className="primary-button"
                            >
                              Validar transferencia
                            </PendingActionButton>
                            <PendingActionButton
                              name="decision"
                              value="rejected"
                              pendingLabel="Revocando…"
                              className="ghost-button"
                            >
                              Rechazar y revocar
                            </PendingActionButton>
                          </form>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state">
                  No hay pagos por transferencia asociados a esta alumna.
                </div>
              )}
            </div>
          ) : null}

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
