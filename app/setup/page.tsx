import Link from "next/link";
import { createInitialOwnerAccount } from "@/app/auth/actions";

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string }>;
}) {
  const { error, created } = await searchParams;

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="back-link" href="/">
          ← Inicio
        </Link>
        <p className="eyebrow">CONFIGURACIÓN INICIAL</p>
        <h1 className="auth-title">Cuenta propietaria</h1>
        <p className="auth-copy">
          Crea la primera cuenta de administración. Después de crearla, se asignará manualmente como
          propietaria de Demeter y esta ruta se retirará.
        </p>

        {created === "1" ? (
          <div className="notice success">
            Cuenta creada. Si Supabase te envió un correo de confirmación, confírmalo. Después
            vuelve aquí al chat para asignarte el rol de propietario.
          </div>
        ) : null}
        {error === "invalid" ? (
          <div className="notice error">
            Completa todos los campos y usa una contraseña de al menos 8 caracteres.
          </div>
        ) : null}
        {error === "signup" ? (
          <div className="notice error">
            No se pudo crear la cuenta. Puede que el correo ya exista.
          </div>
        ) : null}

        {created !== "1" ? (
          <form action={createInitialOwnerAccount} className="auth-form">
            <label>
              Nombre
              <input
                name="full_name"
                type="text"
                autoComplete="name"
                required
                placeholder="Tu nombre"
              />
            </label>
            <label>
              Correo
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="tu@correo.com"
              />
            </label>
            <label>
              Contraseña
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                placeholder="Mínimo 8 caracteres"
              />
            </label>
            <button className="primary-button" type="submit">
              Crear cuenta propietaria
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
