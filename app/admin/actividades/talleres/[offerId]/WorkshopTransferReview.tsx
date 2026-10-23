"use client";

import { useActionState } from "react";
import {
  reviewWorkshopTransfer,
  type WorkshopTransferReviewState,
} from "../transfer-review-actions";

export interface ProvisionalReviewItem {
  id: string;
  student_id: string;
  student_name: string;
  transfer_reference: string;
  amount_minor: number;
  total_minor: number;
  expires_at: string;
  session_count: number;
  receipt_path?: string | null;
  receipt_url?: string | null;
}

function ReviewItem({ item }: { item: ProvisionalReviewItem }) {
  const [state, submit, pending] = useActionState<WorkshopTransferReviewState, FormData>(
    reviewWorkshopTransfer,
    { error: null },
  );
  const money = (minor: number) =>
    new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(minor / 100);
  return (
    <form action={submit} className="activities-stage">
      <input type="hidden" name="hold_id" value={item.id} />
      <h3>{item.student_name}</h3>
      <p>
        {item.session_count} fechas apartadas · Comprobante: {item.transfer_reference}
      </p>
      <p>
        Importe declarado: <strong>{money(item.amount_minor)}</strong> de {money(item.total_minor)}
      </p>
      {item.receipt_url ? (
        <a href={item.receipt_url} target="_blank" rel="noopener noreferrer">
          Abrir comprobante privado
        </a>
      ) : null}
      <p>Vence: {new Date(item.expires_at).toLocaleString("es-MX")}</p>
      <label>
        <input type="checkbox" name="payment_received" value="on" disabled={pending} />
        Confirmo que verifiqué personalmente el ingreso en la cuenta bancaria
      </label>
      <label className="activities-field">
        <span>Motivo de rechazo (obligatorio al rechazar)</span>
        <input name="reason" maxLength={500} disabled={pending} />
      </label>
      <div className="activities-form-actions">
        <button type="submit" name="decision" value="approve" disabled={pending}>
          Aprobar pago y reservar
        </button>
        <button type="submit" name="decision" value="reject" disabled={pending}>
          Rechazar comprobante
        </button>
      </div>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.result ? (
        <p role="status">
          {state.result.state === "confirmed" ? "Pago confirmado" : "Comprobante rechazado"}.
          {state.result.replayed ? " Operación ya procesada." : ""}
        </p>
      ) : null}
    </form>
  );
}

export function WorkshopTransferReview({ items }: { items: ProvisionalReviewItem[] }) {
  return (
    <section aria-labelledby="workshop-transfer-review-heading">
      <h2 id="workshop-transfer-review-heading">Transferencias por verificar</h2>
      <p>
        Un comprobante recibido no equivale a un pago verificado. Confirma el ingreso antes de
        aprobar.
      </p>
      {items.length ? (
        items.map((item) => <ReviewItem key={item.id} item={item} />)
      ) : (
        <p>Sin comprobantes pendientes de revisión.</p>
      )}
    </section>
  );
}
