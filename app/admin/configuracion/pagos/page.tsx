import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { BankTransferSettingsForm } from "../BankTransferSettingsForm";
import { reviewTransferPurchaseAction } from "../actions";
import "../advanced-v2.css";

const errorCopy: Record<string, string> = {
  transfer: "Revisa los datos bancarios antes de guardar.",
  transfer_save: "No pudimos guardar los datos de transferencia.",
  review: "No pudimos actualizar la revisión del comprobante.",
};

export default async function PaymentSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const [{ data }, { data: pendingReviews }] = await Promise.all([
    ctx.supabase
      .from("studio_bank_transfer_settings")
      .select("enabled,bank_name,account_holder,clabe,account_number,card_number,instructions")
      .eq("studio_id", ctx.studio.id)
      .maybeSingle(),
    ctx.supabase
      .from("assistant_transfer_purchase_intents")
      .select(
        "id,student_id,product_template_id,amount_minor,currency,receipt_received_at,status",
      )
      .eq("studio_id", ctx.studio.id)
      .eq("status", "provisional_active")
      .order("receipt_received_at", { ascending: true }),
  ]);

  const reviews = pendingReviews ?? [];
  const studentIds = [...new Set(reviews.map((item) => item.student_id))];
  const productIds = [...new Set(reviews.map((item) => item.product_template_id))];

  const [{ data: students }, { data: products }] = await Promise.all([
    studentIds.length
      ? ctx.supabase
          .from("students")
          .select("id,full_name")
          .eq("studio_id", ctx.studio.id)
          .in("id", studentIds)
      : Promise.resolve({ data: [] }),
    productIds.length
      ? ctx.supabase
          .from("product_templates")
          .select("id,name")
          .eq("studio_id", ctx.studio.id)
          .in("id", productIds)
      : Promise.resolve({ data: [] }),
  ]);

  const studentMap = new Map((students ?? []).map((item) => [item.id, item.full_name]));
  const productMap = new Map((products ?? []).map((item) => [item.id, item.name]));

  return (
    <main className="advanced-v2 advanced-v2-detail">
      <header className="advanced-v2-header">
        <div>
          <Link className="advanced-v2-back" href="/admin/mas">
            ← Más
          </Link>
          <h1>Pagos y transferencias</h1>
          <p>Configura los datos que Demi puede compartir cuando una alumna elige transferencia.</p>
        </div>
      </header>

      {params.saved === "transfer" ? (
        <div className="advanced-v2-notice is-success">Datos de transferencia actualizados.</div>
      ) : null}

      {params.error ? (
        <div className="advanced-v2-notice is-error">
          {errorCopy[params.error] ?? "No pudimos guardar los cambios."}
        </div>
      ) : null}

      {params.reviewed === "approved" ? (
        <div className="advanced-v2-notice is-success">
          Transferencia validada. El paquete quedó confirmado.
        </div>
      ) : null}

      {params.reviewed === "rejected" ? (
        <div className="advanced-v2-notice is-success">
          Transferencia rechazada. El paquete provisional fue revocado sin borrar el historial.
        </div>
      ) : null}

      <section className="advanced-v2-form-card">
        <BankTransferSettingsForm
          enabled={data?.enabled ?? false}
          bankName={data?.bank_name ?? ""}
          accountHolder={data?.account_holder ?? ""}
          clabe={data?.clabe ?? ""}
          accountNumber={data?.account_number ?? ""}
          cardNumber={data?.card_number ?? ""}
          instructions={data?.instructions ?? ""}
        />
      </section>

      <section className="advanced-v2-form-card" style={{ marginTop: 20 }}>
        <div className="advanced-v2-field">
          <span>Comprobantes pendientes de validación</span>
          <small>
            Demi activa estos paquetes de forma provisional al recibir el comprobante.
            Aquí confirmas si la transferencia realmente llegó.
          </small>
        </div>

        {reviews.length ? (
          <div style={{ display: "grid", gap: 12 }}>
            {reviews.map((item) => {
              const amount = new Intl.NumberFormat("es-MX", {
                style: "currency",
                currency: item.currency,
              }).format(item.amount_minor / 100);

              return (
                <article
                  key={item.id}
                  style={{
                    border: "1px solid rgba(0,0,0,.12)",
                    borderRadius: 16,
                    padding: 16,
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <strong>{studentMap.get(item.student_id) ?? "Alumna"}</strong>
                  <span>{productMap.get(item.product_template_id) ?? "Paquete"}</span>
                  <span>{amount}</span>
                  <small>
                    Comprobante recibido{" "}
                    {item.receipt_received_at
                      ? new Date(item.receipt_received_at).toLocaleString("es-MX", {
                          timeZone: ctx.studio.timezone,
                        })
                      : ""}
                  </small>

                  <form
                    action={reviewTransferPurchaseAction}
                    style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                  >
                    <input type="hidden" name="intent_id" value={item.id} />
                    <button
                      className="advanced-v2-save"
                      type="submit"
                      name="decision"
                      value="approved"
                    >
                      Validar transferencia
                    </button>
                    <button
                      type="submit"
                      name="decision"
                      value="rejected"
                      style={{
                        border: "1px solid rgba(0,0,0,.18)",
                        borderRadius: 12,
                        padding: "10px 14px",
                        background: "transparent",
                      }}
                    >
                      Rechazar y revocar
                    </button>
                  </form>
                </article>
              );
            })}
          </div>
        ) : (
          <p style={{ margin: 0 }}>No hay comprobantes pendientes.</p>
        )}
      </section>
    </main>
  );
}
