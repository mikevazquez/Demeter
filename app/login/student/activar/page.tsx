import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { completeStudentPasswordActivation } from "./actions";

const messages: Record<string, string> = {
  invalid: "Usa al menos 8 caracteres y confirma la misma contraseña.",
  link: "Este enlace ya no es válido o expiró. Pide al estudio que te envíe uno nuevo.",
  password: "No se pudo guardar la nueva contraseña.",
  save: "La contraseña cambió, pero no se pudo completar la activación. Intenta de nuevo.",
};

export default async function StudentActivationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; token_hash?: string; type?: string }>;
}) {
  const { error, token_hash: tokenHash, type } = await searchParams;
  const recoveryToken = typeof tokenHash === "string" && type === "recovery" ? tokenHash : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !recoveryToken) {
    if (tokenHash || type) redirect("/login/student/activar?error=link");
    redirect("/login/student");
  }

  if (user) {
    const [{ data: account }, { data: membership }] = await Promise.all([
      supabase
        .from("user_accounts")
        .select("status, must_change_password")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("studio_memberships")
        .select("role, active")
        .eq("user_id", user.id)
        .eq("role", "student")
        .eq("active", true)
        .limit(1)
        .maybeSingle(),
    ]);

    if (!account || account.status !== "active" || !membership) {
      await supabase.auth.signOut();
      redirect("/login/student?error=access");
    }

    if (!account.must_change_password) redirect("/student");
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">DEMETER</p>
        <h1 className="auth-title">Crea tu contraseña</h1>
        <p className="auth-copy">
          Elige la contraseña que usarás para entrar a Studio Flow. Debe tener al menos 8
          caracteres.
        </p>

        {error && messages[error] ? <div className="notice error">{messages[error]}</div> : null}

        <form action={completeStudentPasswordActivation} className="auth-form">
          {recoveryToken ? (
            <>
              <input type="hidden" name="token_hash" value={recoveryToken} />
              <input type="hidden" name="type" value="recovery" />
            </>
          ) : null}
          <label>
            Nueva contraseña
            <input
              name="password"
              type="password"
              minLength={8}
              autoComplete="new-password"
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
              required
              placeholder="Repite tu contraseña"
            />
          </label>
          <button className="primary-button" type="submit">
            Guardar y entrar
          </button>
        </form>
      </section>
    </main>
  );
}
