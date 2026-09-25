import { redirect } from "next/navigation";

import { selectStudentStudio } from "@/app/auth/actions";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";
import { PendingSubmitButton } from "../../pending-submit-button";

export default async function StudentStudioSelectorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login/student");

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
      .eq("role", "student")
      .eq("active", true),
  ]);

  if (!account || account.status !== "active" || membershipError) {
    await supabase.auth.signOut();
    redirect("/login/student?error=access");
  }

  if (account.must_change_password) redirect("/login/student/activar");

  const { data: studentPortalCapability, error: capabilityError } = await supabase
    .from("role_capabilities")
    .select("capability_key")
    .eq("role", "student")
    .eq("capability_key", CAPABILITIES.STUDENT_PORTAL)
    .maybeSingle();

  if (capabilityError || !studentPortalCapability) {
    await supabase.auth.signOut();
    redirect("/login/student?error=access");
  }

  const studioIds = [...new Set((memberships ?? []).map((item) => item.studio_id))];
  const [studiosResult, studentsResult] = studioIds.length
    ? await Promise.all([
        supabase
          .from("studios")
          .select("id, name, status")
          .in("id", studioIds)
          .eq("status", "active")
          .order("name"),
        supabase
          .from("students")
          .select("studio_id")
          .eq("user_id", user.id)
          .eq("active", true)
          .eq("lifecycle_status", "active")
          .in("studio_id", studioIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  if (studiosResult.error || studentsResult.error) {
    await supabase.auth.signOut();
    redirect("/login/student?error=access");
  }

  const studentStudioIds = new Set((studentsResult.data ?? []).map((item) => item.studio_id));
  const studioMap = new Map((studiosResult.data ?? []).map((studio) => [studio.id, studio]));

  const options = (memberships ?? [])
    .filter((membership) => studentStudioIds.has(membership.studio_id))
    .map((membership) => ({
      ...membership,
      studio: studioMap.get(membership.studio_id),
    }))
    .filter((item) => item.studio);

  if (!options.length) {
    await supabase.auth.signOut();
    redirect("/login/student?error=access");
  }

  if (options.length === 1) {
    const onlyStudio = options[0].studio!;
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow">STUDIO FLOW</p>
          <h1 className="auth-title">Abre tu estudio</h1>
          <p className="auth-copy">Confirma el estudio al que quieres entrar.</p>
          <form action={selectStudentStudio} className="auth-form">
            <input type="hidden" name="studio_id" value={onlyStudio.id} />
            <PendingSubmitButton className="portal-card" pendingLabel="Abriendo estudio…">
              <span className="portal-kicker">Alumna</span>
              <strong>{onlyStudio.name}</strong>
              <span className="portal-arrow">→</span>
            </PendingSubmitButton>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">STUDIO FLOW</p>
        <h1 className="auth-title">Selecciona tu estudio</h1>
        <p className="auth-copy">
          Tienes acceso como alumna a más de un estudio. Elige cuál quieres abrir.
        </p>

        {error ? (
          <div className="notice error">
            No pudimos abrir ese estudio. Selecciona una opción disponible.
          </div>
        ) : null}

        <div className="auth-form">
          {options.map((option) => (
            <form action={selectStudentStudio} key={option.studio_id}>
              <input type="hidden" name="studio_id" value={option.studio_id} />
              <PendingSubmitButton className="portal-card" pendingLabel="Abriendo estudio…">
                <span className="portal-kicker">Alumna</span>
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
