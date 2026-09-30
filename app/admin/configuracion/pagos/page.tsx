import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import {
  createPaymentMethodAction,
  togglePaymentMethodAction,
  updatePaymentMethodAction,
} from "./actions";
import "./payments-v2.css";

const categoryCopy: Record<string, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card: "Tarjeta",
  digital: "Digital",
  other: "Otro",
};

const savedCopy: Record<string, string> = {
  created: "Método de pago creado.",
  updated: "Método de pago actualizado.",
  activated: "Método de pago activado.",
  deactivated: "Método de pago desactivado.",
};

const errorCopy: Record<string, string> = {
  name: "Escribe un nombre válido para el método de pago.",
  category: "Selecciona un tipo de método válido.",
  save: "No pudimos guardar los cambios.",
  last_active: "Debe quedar al menos un método de pago activo.",
};

export default async function PaymentsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const [{ data: methods }, { count: onlineProducts }, { count: onlineAttempts }] =
    await Promise.all([
      ctx.supabase
        .from("studio_payment_methods")
        .select(
          "code,name,category,active,requires_reference,allow_refunds,sort_order,is_system",
        )
        .eq("studio_id", ctx.studio.id)
        .order("sort_order"),
      ctx.supabase
        .from("product_templates")
        .select("id", { count: "exact", head: true })
        .eq("studio_id", ctx.studio.id)
        .eq("active", true)
        .eq("online_purchasable", true),
      ctx.supabase
        .from("online_checkout_attempts")
        .select("id", { count: "exact", head: true })
        .eq("studio_id", ctx.studio.id),
    ]);

  return (
    <main className="payments-v2">
      <header className="payments-v2-header">
        <div>
          <Link className="payments-v2-back" href="/admin/mas">
            ← Más
          </Link>
          <h1>Pagos</h1>
          <p>Define cómo se registran los cobros y reembolsos del estudio.</p>
        </div>

        <details className="payments-v2-create">
          <summary className="payments-v2-primary">＋ Método</summary>
          <form action={createPaymentMethodAction} className="payments-v2-create-panel">
            <div>
              <strong>Nuevo método</strong>
              <small>Úsalo cuando tu estudio maneje una forma de pago adicional.</small>
            </div>

            <label className="payments-v2-field">
              <span>Nombre</span>
              <input name="name" required maxLength={60} placeholder="Ej. Terminal BBVA" />
            </label>

            <label className="payments-v2-field">
              <span>Tipo</span>
              <select name="category" defaultValue="other">
                <option value="cash">Efectivo</option>
                <option value="transfer">Transferencia</option>
                <option value="card">Tarjeta</option>
                <option value="digital">Digital</option>
                <option value="other">Otro</option>
              </select>
            </label>

            <label className="payments-v2-check">
              <input type="checkbox" name="requires_reference" />
              <span>Requiere referencia al cobrar</span>
            </label>

            <label className="payments-v2-check">
              <input type="checkbox" name="allow_refunds" defaultChecked />
              <span>Permitir usarlo en reembolsos</span>
            </label>

            <button className="payments-v2-primary" type="submit">
              Crear método
            </button>
          </form>
        </details>
      </header>

      {params.saved && savedCopy[params.saved] ? (
        <div className="payments-v2-notice is-success">{savedCopy[params.saved]}</div>
      ) : null}

      {params.error ? (
        <div className="payments-v2-notice is-error">
          {errorCopy[params.error] ?? "No pudimos guardar los cambios."}
        </div>
      ) : null}

      <section className="payments-v2-section">
        <div className="payments-v2-section-heading">
          <div>
            <h2>Métodos manuales</h2>
            <p>Son los métodos que aparecen al registrar una venta o un pago pendiente.</p>
          </div>
        </div>

        <div className="payments-v2-list">
          {(methods ?? []).map((method) => (
            <article className="payments-v2-row" key={method.code}>
              <span className="payments-v2-icon" data-category={method.category}>
                {method.category === "cash"
                  ? "$"
                  : method.category === "transfer"
                    ? "↗"
                    : method.category === "card"
                      ? "▭"
                      : method.category === "digital"
                        ? "◉"
                        : "＋"}
              </span>

              <span className="payments-v2-row-copy">
                <strong>{method.name}</strong>
                <small>
                  {categoryCopy[method.category] ?? "Otro"}
                  {method.requires_reference ? " · referencia obligatoria" : " · sin referencia obligatoria"}
                  {method.allow_refunds ? " · admite reembolsos" : " · sin reembolsos"}
                </small>
                <code>{method.code}</code>
              </span>

              <span className={`payments-v2-status ${method.active ? "is-active" : ""}`}>
                {method.active ? "Activo" : "Inactivo"}
              </span>

              <details className="payments-v2-edit">
                <summary>Editar</summary>
                <form action={updatePaymentMethodAction} className="payments-v2-edit-panel">
                  <input type="hidden" name="code" value={method.code} />

                  <label className="payments-v2-field">
                    <span>Nombre visible</span>
                    <input name="name" required maxLength={60} defaultValue={method.name} />
                  </label>

                  <label className="payments-v2-check">
                    <input
                      type="checkbox"
                      name="requires_reference"
                      defaultChecked={method.requires_reference}
                    />
                    <span>Requiere referencia</span>
                  </label>

                  <label className="payments-v2-check">
                    <input
                      type="checkbox"
                      name="allow_refunds"
                      defaultChecked={method.allow_refunds}
                    />
                    <span>Permitir reembolsos</span>
                  </label>

                  <button className="payments-v2-primary" type="submit">
                    Guardar
                  </button>
                </form>
              </details>

              <form action={togglePaymentMethodAction}>
                <input type="hidden" name="code" value={method.code} />
                <input type="hidden" name="next_active" value={method.active ? "0" : "1"} />
                <button
                  className={method.active ? "payments-v2-secondary" : "payments-v2-primary"}
                  type="submit"
                >
                  {method.active ? "Desactivar" : "Activar"}
                </button>
              </form>
            </article>
          ))}
        </div>
      </section>

      <section className="payments-v2-section">
        <div className="payments-v2-section-heading">
          <div>
            <h2>Pago en línea</h2>
            <p>El checkout de alumnas usa el proveedor configurado por Studio Flow.</p>
          </div>
        </div>

        <article className="payments-v2-online">
          <span className="payments-v2-online-mark">MP</span>
          <span>
            <strong>Mercado Pago</strong>
            <small>
              {onlineProducts ?? 0} productos disponibles para compra en línea · {onlineAttempts ?? 0} intentos registrados
            </small>
          </span>
          <span className="payments-v2-status is-active">Proveedor actual</span>
        </article>

        <p className="payments-v2-help">
          La disponibilidad para compra en línea se decide en cada paquete. Pagos no modifica esas reglas.
        </p>
      </section>
    </main>
  );
}
