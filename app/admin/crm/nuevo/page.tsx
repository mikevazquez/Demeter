import Link from "next/link";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { createStudent } from "../../alumnas/actions";
import PendingActionButton from "../../components/PendingActionButton";
export default async function NewContactPage() {
  await getAdminContext(CAPABILITIES.STUDENTS_WRITE);
  return (
    <>
      <Link className="crm-back" href="/admin/crm">
        ← Contactos
      </Link>
      <header className="crm-heading">
        <div>
          <h1>Nuevo contacto</h1>
          <p>Crea un expediente único para continuar con su alta, prueba e inscripción.</p>
        </div>
      </header>
      <section className="crm-panel">
        <form action={createStudent} className="crm-form-grid">
          <label>
            Nombre
            <input name="first_name" required autoComplete="given-name" maxLength={100} />
          </label>
          <label>
            Apellido
            <input name="last_name" autoComplete="family-name" maxLength={100} />
          </label>
          <label>
            Teléfono
            <input
              name="phone"
              required
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="10 dígitos"
            />
          </label>
          <label>
            Correo
            <input name="email" type="email" autoComplete="email" />
          </label>
          <PendingActionButton className="crm-primary" pendingLabel="Creando expediente…">
            Crear y continuar
          </PendingActionButton>
        </form>
      </section>
    </>
  );
}
