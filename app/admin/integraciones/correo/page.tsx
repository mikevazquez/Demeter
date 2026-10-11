import Link from "next/link";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { connectEmailAction } from "./actions";
export default async function EmailPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const [{ supabase, studio }, query] = await Promise.all([
    getAdminContext(CAPABILITIES.SETTINGS_WRITE),
    searchParams,
  ]);
  const { data } = await supabase.rpc("admin_email_connection_snapshot", {
    p_studio_id: studio.id,
  });
  const connection = data as { provider: string; from_email: string; tested_at: string } | null;
  return (
    <main className="portal-page">
      <header className="portal-module-heading">
        <div>
          <Link href="/admin/integraciones" className="flow-back">
            ‹ Integraciones
          </Link>
          <h1>Correo</h1>
          <p>Conecta un remitente verificado para las comunicaciones de tu estudio.</p>
        </div>
      </header>
      {query.saved ? (
        <p className="notice success">Correo de prueba aceptado. Proveedor conectado.</p>
      ) : null}
      {query.error ? (
        <p className="notice error">
          {query.error === "test"
            ? "El proveedor no aceptó el correo de prueba. Revisa las credenciales y verifica el remitente."
            : "No pudimos guardar la conexión. Revisa los datos."}
        </p>
      ) : null}
      {connection ? (
        <section className="card">
          <h2>Conectado · {connection.provider}</h2>
          <p>{connection.from_email}</p>
          <p className="portal-muted">
            Las credenciales se guardan cifradas y no se muestran en el panel.
          </p>
        </section>
      ) : null}
      <form action={connectEmailAction} className="card portal-form">
        <label>
          Proveedor
          <select name="provider" required defaultValue={connection?.provider ?? "resend"}>
            <option value="resend">Resend</option>
            <option value="sendgrid">SendGrid</option>
            <option value="ses">Amazon SES</option>
          </select>
        </label>
        <label>
          Remitente verificado
          <input
            type="email"
            name="from_email"
            required
            defaultValue={connection?.from_email}
            placeholder="hola@tuestudio.com"
          />
        </label>
        <label>
          API key o Secret Access Key de SES
          <input type="password" name="api_key" required autoComplete="new-password" />
        </label>
        <details>
          <summary>Credenciales de Amazon SES</summary>
          <label>
            Access Key ID
            <input name="access_key_id" autoComplete="off" />
          </label>
          <label>
            Región
            <input name="region" defaultValue="us-east-1" />
          </label>
        </details>
        <label>
          Enviar correo de prueba a<input type="email" name="test_email" required />
        </label>
        <p className="portal-muted">
          La conexión se habilita cuando el proveedor acepta el correo de prueba.
        </p>
        <button className="portal-button portal-button-primary">Conectar y enviar prueba</button>
      </form>
    </main>
  );
}
