import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CreateClassPackageForm } from "../CreateClassPackageForm";

export default async function NewClassPackagePage() {
  const ctx = await getAdminContext("products.write");

  const { count } = await ctx.supabase
    .from("disciplines")
    .select("id", { count: "exact", head: true })
    .eq("studio_id", ctx.studio.id)
    .eq("active", true);

  return (
    <main className="packages-v2">
      <header className="packages-v2-header">
        <Link href="/admin/productos/por-clases" className="packages-v2-back">
          <span aria-hidden="true">←</span> Por clases
        </Link>
        <h1>Crear paquete</h1>
        <p>Configura un paquete por cantidad de clases y vigencia.</p>
      </header>

      {!count ? (
        <section className="packages-v2-info" role="alert">
          <span className="packages-v2-info-icon" aria-hidden="true">
            !
          </span>
          <p>
            Aún no hay disciplinas activas. Crea primero una actividad con disciplina para poder
            generar un paquete que aplique a todas.
          </p>
        </section>
      ) : (
        <CreateClassPackageForm currency={ctx.studio.currency} locale={ctx.studio.locale} />
      )}
    </main>
  );
}
