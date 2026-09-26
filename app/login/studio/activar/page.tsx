import { redirect } from "next/navigation";

import { completeStudioPasswordActivation } from "@/app/auth/actions";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";
import { getPublicStudioPortal } from "@/lib/studio-public-portal";
import { PendingSubmitButton } from "../../pending-submit-button";

const messages: Record<string, string> = {
  invalid: "Usa al menos 8 caracteres y confirma la misma contraseña.",
  password: "No se pudo guardar la nueva contraseña.",
  save: "La contraseña cambió, pero no se pudo completar la activación. Intenta de nuevo.",
};

export default async function StudioActivationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; studio?: string }>;
}) {
  const { error, studio: requestedStudioSlug } = await searchParams;
  const portal = requestedStudioSlug
    ? await getPublicStudioPortal(requestedStudioSlug)
    : null;
  const brandName = portal?.name ?? "Studio Flow";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      requestedStudioSlug
        ? `/login/studio?studio=${encodeURIComponent(requestedStudioSlug)}`
        : "/login/studio",
    );
  }

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

  const eligiblePortalRoles = new Set((portalCapabilities ?? []).map((item) => item.role));
  const supportsActivation = memberships.some(
    (membership) =>
      ["owner", "admin", "instructor"].includes(membership.role) &&
      eligiblePortalRoles.has(membership.role),
  );

  if (!supportsActivation) {
    await supabase.auth.signOut();
    redirect("/login/studio?error=activation");
  }

  if (!account.must_change_password) redirect("/login/studio/seleccionar");

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">{brandName.toUpperCase()}</p>
        <h1 className="auth-title">Activa tu acceso</h1>
        <p className="auth-copy">
          Es tu primer ingreso a {brandName}. Crea una contraseña personal para continuar.
        </p>

        {error && messages[error] ? <div className="notice error">{messages[error]}</div> : null}

        <form action={completeStudioPasswordActivation} className="auth-form">
          {portal?.slug ? <input type="hidden" name="studio_slug" value={portal.slug} /> : null}
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
