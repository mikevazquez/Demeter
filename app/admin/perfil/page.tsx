import { redirect } from "next/navigation";

import { signOut } from "@/app/auth/actions";
import { getAdminContext } from "@/lib/auth/admin-context";

export default async function CoachProfilePage() {
  const { supabase, membership, user, studio } = await getAdminContext();

  if (membership.role !== "instructor") redirect("/admin");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  const name = profile?.full_name?.trim() || user.email?.split("@")[0] || "Coach";
  const initials =
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((part: string) => part.slice(0, 1).toUpperCase())
      .join("") || "C";

  return (
    <main className="dashboard-shell coach-profile-page">
      <section className="coach-profile-card">
        <span className="coach-profile-avatar" aria-hidden="true">
          {initials}
        </span>
        <p className="eyebrow">COACH · {studio.name}</p>
        <h1 className="dashboard-title">{name}</h1>
        <p className="coach-profile-copy">
          Tu operación diaria está concentrada en Hoy. Ahí puedes ver únicamente tus clases
          asignadas, el roster y la asistencia en tiempo real.
        </p>
        <form action={signOut}>
          <button type="submit" className="secondary-button">
            Cerrar sesión
          </button>
        </form>
      </section>
    </main>
  );
}
