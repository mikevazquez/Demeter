import Link from "next/link";
import { loadCrm } from "@/lib/crm/data";
import ContactList from "./ContactList";
export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ contacts, canEdit }, query] = await Promise.all([loadCrm(), searchParams]);
  const duplicate = contacts.find((c) => c.studentId === query.duplicate);
  const errors: Record<string, string> = {
    first_name_required: "Indica el nombre.",
    phone_invalid: "Indica un teléfono mexicano de 10 dígitos.",
    phone_exists: "Este teléfono ya tiene expediente.",
    student_create_failed: "No se pudo crear el expediente. Revisa los datos e intenta otra vez.",
  };
  return (
    <>
      {query.error && (
        <div role="alert" className="crm-panel">
          <p>{errors[query.error] || "No se pudo completar la operación."}</p>
          <Link href="/admin/crm/nuevo">Volver al formulario</Link>
        </div>
      )}
      {query.duplicate && (
        <div role="status" className="crm-panel">
          <p>Ya existe un expediente con este teléfono. Se conserva el mismo contacto.</p>
          {duplicate && <Link href={`/admin/crm/${duplicate.id}`}>Abrir {duplicate.name}</Link>}
        </div>
      )}
      {query.deleted && <p role="status">Expediente archivado. Se conservó su historial.</p>}
      <ContactList contacts={contacts} canEdit={canEdit} initialQuery={query.q} />
    </>
  );
}
