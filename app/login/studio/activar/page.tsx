import { redirect } from "next/navigation";

import { completeStudioPasswordActivation } from "@/app/auth/actions";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";
import { PendingSubmitButton } from "../../pending-submit-button";

const messages: Record<string, string> = {
  invalid: "Usa al menos 8 caracteres y confirma la misma contraseña.",
  password: "No se pudo guardar la nueva contraseña.",
  save: "La contraseña cambió, pero no se pudo completar la activación. Intenta de nuevo.",
};

export default async function StudioActivationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login/studio");

  const [{ data: account }, { data: memberships }] = await Promise.all([
    supabase
      .from("user_accounts")
      .select("status, must_change_password")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("studio_memberships")
      .select("role, active")
      .eq("user_id", user.id)
      .eq("active", true),
  ]);

  if (!account || account.status !== "active" || !memberships?.length) {
    await supabase.auth.signOut();
    redirect("/login/studio?error=access");
  }

  const roles = [...new Set(memberships.map((item) => item.role))];
  const { data: portalCapabilities } = await supabase
    .from("role_capabilities")
    .select("role, capability_key")
    .in("role", roles)
    .in("capability_key", [CAPABILITIES.ADMIN_PORTAL, CAPABILITIES.INSTRUCTOR_PORTAL]);

  if (!portalCapabilities?.length) {
    await supabase.auth.signOut();
    redirect("/login/studio?error=access");
  }

  if (!roles.includes("instructor")) {
    await supabase.auth.signOut();
    redirect("/login/studio?error=activation");
  }

  if (!account.must_change_password) redirect("/login/studio/seleccionar");

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">DEMETER · STUDIO FLOW</p>
        <h1 className="auth-title">Activa tu acceso a Studio Flow</h1>
        <p className="auth-copy">
          Es tu primer ingreso. Crea una contraseña personal para continuar.
        </p>

        {error && messages[error] ? <div className="notice error">{messages[error]}</div> : null}

        <form action={completeStudioPasswordActivation} className="auth-form">
          <label>
            Nueva contraseña
            <input
              name="password"
              type="password"
              minLength={8}
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              placeholder="Mínimo 8 caracteres"
            />
          </label>
          <label>
            Confirmar contraseña
            <input
              name="password_confirmation"
              type="password"
              minLength={8}
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              placeholder="Repite tu contraseña"
            />
          </label>
          <PendingSubmitButton pendingLabel="Guardando y entrando…">
            Guardar y entrar
          </PendingSubmitButton>
        </form>
      </section>
    </main>
  );
}
