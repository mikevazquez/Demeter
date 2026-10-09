import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
async function claim(form: FormData) {
  "use server";
  const { supabase, studio } = await getAdminContext(CAPABILITIES.STUDENTS_WRITE);
  const { data, error } = await supabase.rpc("admin_claim_demi_handoff", {
    p_studio: studio.id,
    p_handoff: String(form.get("id") ?? ""),
  });
  redirect(`/admin/mas/demi/atencion?${error || !data?.ok ? "error=1" : "guardado=1"}`);
}
async function resolve(form: FormData) {
  "use server";
  const { supabase, studio } = await getAdminContext(CAPABILITIES.STUDENTS_WRITE);
  const { data, error } = await supabase.rpc("admin_resolve_demi_handoff", {
    p_studio: studio.id,
    p_handoff: String(form.get("id") ?? ""),
    p_note: String(form.get("note") ?? ""),
  });
  redirect(`/admin/mas/demi/atencion?${error || !data?.ok ? "error=1" : "guardado=1"}`);
}
export default async function HumanCases({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; guardado?: string }>;
}) {
  const { supabase, studio, user } = await getAdminContext(CAPABILITIES.STUDENTS_WRITE);
  const { data, error } = await supabase
    .from("assistant_handoffs")
    .select("id,reason_code,note,status,assigned_to,claimed_at,created_at,resolution_note")
    .eq("studio_id", studio.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("human_cases_unavailable");
  const params = await searchParams;
  return (
    <main>
      <Link href="/admin/mas/demi">Volver a Demi</Link>
      <h1>Atención humana</h1>
      <p>
        Al tomar un caso, Demi pausa sus respuestas y seguimientos. Guarda la resolución para
        devolver el control automático conservando el historial.
      </p>
      {params.error && (
        <p role="alert">
          No se pudo actualizar el caso. Revisa la asignación y escribe una resolución.
        </p>
      )}
      {params.guardado && <p role="status">Caso actualizado.</p>}
      {!data?.length && <p>No hay casos registrados.</p>}
      {data?.map((h) => (
        <article key={h.id}>
          <h2>{h.reason_code}</h2>
          <p>{h.note}</p>
          <p>
            {h.status} ·{" "}
            {h.assigned_to === user.id
              ? "Asignado a ti"
              : h.assigned_to
                ? "Asignado a otra persona"
                : "Sin asignar"}
          </p>
          {h.status === "open" ? (
            <>
              <form action={claim}>
                <input type="hidden" name="id" value={h.id} />
                <button type="submit">Tomar caso y pausar Demi</button>
              </form>
              <form action={resolve}>
                <input type="hidden" name="id" value={h.id} />
                <label>
                  Resolución
                  <textarea name="note" required minLength={3} maxLength={2000} />
                </label>
                <button type="submit">Resolver y devolver el control</button>
              </form>
            </>
          ) : (
            <p>{h.resolution_note}</p>
          )}
        </article>
      ))}
    </main>
  );
}
