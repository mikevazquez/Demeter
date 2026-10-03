import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { BankTransferSettingsForm } from "../BankTransferSettingsForm";
import "../advanced-v2.css";

const errorCopy: Record<string, string> = {
  transfer: "Revisa los datos bancarios antes de guardar.",
  transfer_save: "No pudimos guardar los datos de transferencia.",
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

  const { data } = await ctx.supabase
    .from("studio_bank_transfer_settings")
    .select("enabled,bank_name,account_holder,clabe,account_number,card_number,instructions")
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

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
    </main>
  );
}
