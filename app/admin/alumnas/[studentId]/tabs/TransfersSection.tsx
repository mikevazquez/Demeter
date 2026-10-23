import PendingActionButton from "@/app/admin/components/PendingActionButton";
import { reviewStudentTransferPurchaseAction } from "../actions";
import type { Profile360Model } from "../load-profile-360";
import { formatDateTime } from "../profile-format";

/** P360-V2-03 · Pagos por transferencia: comprobantes y validación. */
export default function TransfersSection({ model }: { model: Profile360Model }) {
  const {
    student,
    canReadSales,
    canManageSales,
    transferPurchaseRows,
    groupReceiptReviews,
    groupReceiptUrlMap,
    transferReceiptUrlMap,
    pendingTransferReviews,
    timeZone,
    locale,
    currency,
    productMap,
  } = model;
  if (!canReadSales) return null;
  return (
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
              item.receipt_received_at ?? item.validated_at ?? item.rejected_at ?? item.created_at;

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
                      {item.receipt_received_at ? "Comprobante recibido · " : "Solicitud creada · "}
                      {formatDateTime(eventAt, timeZone, locale)}
                    </p>
                    {item.review_note ? (
                      <p className="mt-2 text-xs text-zinc-400">{item.review_note}</p>
                    ) : null}
                    {!groupReceiptReviews.available ? (
                      <p className="mt-3 text-xs text-amber-300">
                        No se pudo cargar toda la evidencia. Vuelve a intentarlo antes de validar.
                      </p>
                    ) : groupReview ? (
                      <div className="mt-3 rounded-2xl border border-white/10 p-3">
                        <p className="text-xs text-zinc-300">
                          Comprobantes del grupo · Total:{" "}
                          {new Intl.NumberFormat(locale, {
                            style: "currency",
                            currency: groupReview.currency,
                          }).format(groupReview.amountMinor / 100)}
                          . Esta compra tiene asignados {amount}. Revisa todos los documentos.
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
                                <span className="ml-2 text-amber-300">Archivo no disponible</span>
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
                        Comprobante recibido; el archivo todavía no está disponible para vista.
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
        <div className="empty-state">No hay pagos por transferencia asociados a esta alumna.</div>
      )}
    </div>
  );
}
