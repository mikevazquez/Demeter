import { completeStudioPasswordReset } from "@/app/auth/actions";

const messages: Record<string, string> = {
  invalid: "Usa al menos 8 caracteres y confirma la misma contraseña.",
  password: "No pudimos guardar la nueva contraseña.",
};

export default async function ResetStudioPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">DEMETER</p>
        <h1 className="auth-title">Restablece tu contraseña</h1>
        <p className="auth-copy">Crea una nueva contraseña para tu acceso al estudio.</p>

        {error && messages[error] ? <div className="notice error">{messages[error]}</div> : null}

        <form action={completeStudioPasswordReset} className="auth-form">
          <label>
            Nueva contraseña
            <input
              name="password"
              type="password"
              minLength={8}
              autoComplete="new-password"
              required
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
            />
          </label>
          <button className="primary-button" type="submit">
            Guardar contraseña
          </button>
        </form>
      </section>
    </main>
  );
}
