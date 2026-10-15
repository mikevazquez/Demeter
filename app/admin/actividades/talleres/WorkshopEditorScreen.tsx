import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminContext } from "@/lib/auth/admin-context";
import type { WorkshopEditorContext } from "@/src/lib/workshops/editor";
import { WorkshopEditorForm } from "./WorkshopEditorForm";

export async function WorkshopEditorScreen({ offerId }: { offerId?: string }) {
  const ctx = await getAdminContext("products.write");
  const { data, error } = ctx.can("schedule.write")
    ? await ctx.supabase.rpc("admin_workshop_editor_context", {
        p_studio_id: ctx.studio.id,
        p_offer_id: offerId ?? null,
      })
    : { data: null, error: { message: "forbidden" } };
  if (error?.message.includes("offer_not_found")) notFound();
  return (
    <main className="activities-v2 activities-editor-page">
      <Link
        className="activities-v2-back"
        href={offerId ? `/admin/actividades/talleres/${offerId}` : "/admin/actividades/talleres"}
      >
        ← Volver
      </Link>
      <header className="activities-v2-header">
        <h1>{offerId ? "Editar taller" : "Nuevo taller"}</h1>
      </header>
      {error || !data ? (
        <p role="alert">No pudimos abrir el editor. Revisa tu acceso e intenta nuevamente.</p>
      ) : (
        <WorkshopEditorForm
          context={data as WorkshopEditorContext}
          offerId={offerId}
          requestId={randomUUID()}
        />
      )}
    </main>
  );
}
