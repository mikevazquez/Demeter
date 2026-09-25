import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { ProvisionStudioForm } from "./ProvisionStudioForm";

export default async function SetupPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login/studio");

  const { data: platformAdmin } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!platformAdmin) redirect("/");

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="back-link" href="/admin">
          ← Administración
        </Link>
        <p className="eyebrow">STUDIO FLOW · INTERNO</p>
        <h1 className="auth-title">Crear estudio</h1>
        <p className="auth-copy">
          Provisiona un tenant nuevo con owner, sede principal, sala y configuración base.
          Esta herramienta solo está disponible para administración de plataforma.
        </p>

        <ProvisionStudioForm />
      </section>
    </main>
  );
}
