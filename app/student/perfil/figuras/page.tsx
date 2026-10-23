import Link from "next/link";

import { POLE_PHOTO_BUCKET } from "@/lib/pole/constants";
import type { StudentPoleCatalog } from "@/lib/pole/types";
import {
  getStudentShellContext,
  getStudentStudioContext,
  localDateKey,
} from "@/lib/student/portal";

import { PoleFiguresApp } from "./PoleFiguresApp";

export default async function StudentPoleFiguresPage() {
  const [{ supabase, user }, { studio }] = await Promise.all([
    getStudentShellContext(),
    getStudentStudioContext(),
  ]);

  const { data, error } = await supabase.rpc("student_pole_figures", { p_discipline_id: null });
  const catalog = (data ?? null) as StudentPoleCatalog | null;

  if (error || !catalog?.discipline) {
    return (
      <main className="space-y-4 pb-4">
        <header>
          <Link
            href="/student/perfil"
            className="text-xs font-semibold text-zinc-400 hover:text-white"
          >
            ← Perfil
          </Link>
          <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
            Mis figuras
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Figuras de Pole</h1>
        </header>
        <section className="rounded-3xl border border-dashed border-white/15 bg-white/[0.02] p-5 text-sm text-zinc-400">
          {error
            ? "No pudimos cargar tus figuras. Intenta de nuevo en un momento."
            : "Tu estudio todavía no ha cargado el catálogo de figuras."}
        </section>
      </main>
    );
  }

  const timeZone = studio.timezone ?? "America/Mexico_City";
  const today = localDateKey(new Date(), timeZone);

  const photoPaths = catalog.figures
    .map((figure) => figure.achievement?.photo_path)
    .filter((path): path is string => Boolean(path));
  const photoUrls: Record<string, string> = {};
  if (photoPaths.length) {
    const { data: signed } = await supabase.storage
      .from(POLE_PHOTO_BUCKET)
      .createSignedUrls(photoPaths, 60 * 60);
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) photoUrls[item.path] = item.signedUrl;
    }
  }

  const todayIds = catalog.figures
    .filter((figure) => {
      const stamp = figure.achievement?.validated_at ?? figure.achievement?.achieved_at;
      return stamp ? localDateKey(new Date(stamp), timeZone) === today : false;
    })
    .map((figure) => figure.id);

  return (
    <PoleFiguresApp userId={user.id} catalog={catalog} photoUrls={photoUrls} todayIds={todayIds} />
  );
}
