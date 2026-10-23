import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { isPlatformAdmin } from "@/lib/platform/entitlements";
import { createClient } from "@/lib/supabase/server";

import "./plataforma.css";

export const metadata: Metadata = { title: "Nébora · Consola" };

// NEB-01-10 · La consola de Nébora vive fuera de /admin: es de la plataforma, no de un estudio.
// Usa la misma sesión del admin. Quien no es plataforma recibe 404 (no se anuncia que existe).
export default async function PlataformaLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient("admin");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login/studio");
  if (!(await isPlatformAdmin(supabase))) notFound();

  return (
    <div className="neb-console">
      <header className="neb-top">
        <Link href="/plataforma" className="neb-brand">
          Nébora <span>consola</span>
        </Link>
        <nav className="neb-top-nav" aria-label="Consola">
          <Link href="/plataforma">Inicio</Link>
          <Link href="/plataforma#estudios">Estudios</Link>
          <Link href="/plataforma/soporte">Soporte</Link>
          <Link href="/plataforma/lanzamientos">Lanzamientos</Link>
          <Link href="/plataforma/plantillas">Plantillas</Link>
          <Link href="/admin">Ir a mi estudio</Link>
        </nav>
      </header>
      <main className="neb-main">{children}</main>
    </div>
  );
}
