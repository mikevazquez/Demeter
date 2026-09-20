import { redirect } from "next/navigation";

import { selectStudio } from "@/app/auth/actions";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";
import { PendingSubmitButton } from "../../pending-submit-button";

const roleLabels: Record<string, string> = {
  owner: "Owner",
  admin: "Administración",
  reception: "Recepción",
  instructor: "Coach",
};

export default async function StudioSelectorPage({
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

  const [{ data: account }, { data: memberships, error: membershipError }] = await Promise.all([
    supabase
      .from("user_accounts")
      .select("status, must_change_password")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("studio_memberships")
      .select("studio_id, role, active")
      .eq("user_id", user.id)
      .eq("active", true),
  ]);

  if (!account || account.status !== "active" || membershipError) {
    await supabase.auth.signOut();
    redirect("/login/studio?error=access");
  }

  if (account.must_change_password) redirect("/login/studio/activar");

  const roles = [...new Set((memberships ?? []).map((item) => item.role))];
  const { data: capabilities } = roles.length
    ? await supabase
        .from("role_capabilities")
        .select("role, capability_key")
        .in("role", roles)
        .in("capability_key", [CAPABILITIES.ADMIN_PORTAL, CAPABILITIES.INSTRUCTOR_PORTAL])
    : { data: [] as { role: string; capability_key: string }[] };

  const eligibleRoles = new Set((capabilities ?? []).map((item) => item.role));
  const eligibleMemberships = (memberships ?? []).filter((item) => eligibleRoles.has(item.role));
  const studioIds = [...new Set(eligibleMemberships.map((item) => item.studio_id))];
  const { data: studios } = studioIds.length
    ? await supabase
        .from("studios")
        .select("id, name, status")
        .in("id", studioIds)
        .eq("status", "active")
        .order("name")
    : { data: [] as { id: string; name: string; status: string }[] };

  const studioMap = new Map((studios ?? []).map((studio) => [studio.id, studio]));

  const options = eligibleMemberships
    .map((membership) => ({
      ...membership,
      studio: studioMap.get(membership.studio_id),
    }))
    .filter((item) => item.studio);

  if (!options.length) {
    await supabase.auth.signOut();
    redirect("/login/studio?error=access");
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">DEMETER</p>
        <h1 className="auth-title">Selecciona un estudio</h1>
        <p className="auth-copy">
          Tienes acceso a más de un estudio. Elige con cuál quieres trabajar.
        </p>

        {error ? (
          <div className="notice error">
            No pudimos abrir ese estudio. Selecciona una opción disponible.
          </div>
        ) : null}

        <div className="auth-form">
          {options.map((option) => (
            <form action={selectStudio} key={option.studio_id}>
              <input type="hidden" name="studio_id" value={option.studio_id} />
              <PendingSubmitButton className="portal-card" pendingLabel="Abriendo estudio…">
                <span className="portal-kicker">{roleLabels[option.role] ?? "Equipo"}</span>
                <strong>{option.studio!.name}</strong>
                <span className="portal-arrow">→</span>
              </PendingSubmitButton>
            </form>
          ))}
        </div>
      </section>
    </main>
  );
}
