import Link from "next/link";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import LifecycleSettingsForm from "../LifecycleSettingsForm";

export default async function CrmSettingsPage() {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const { data, error } = await supabase
    .from("crm_lifecycle_settings")
    .select("inactivity_days")
    .eq("studio_id", studio.id)
    .maybeSingle();
  if (error) throw new Error("crm_settings_unavailable");
  return (
    <>
      <Link className="crm-back" href="/admin/crm">
        ← Contactos
      </Link>
      <header className="crm-heading">
        <div>
          <h1>Ajustes del CRM</h1>
          <p>Configura cuándo una alumna sin paquete activo pasa a Exalumna.</p>
        </div>
      </header>
      <section className="crm-panel">
        <LifecycleSettingsForm days={Number(data?.inactivity_days || 15)} />
      </section>
    </>
  );
}
