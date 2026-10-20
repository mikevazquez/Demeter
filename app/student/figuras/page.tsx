import Image from "next/image";
import Link from "next/link";

import catalog from "@/app/admin/catalogo/pole-catalog-data.json";
import { getStudentPortalContext } from "@/lib/student/portal";

import PoleFigurePhotoPicker from "./PoleFigurePhotoPicker";

type CatalogFigure = {
  id: string;
  nombre: string;
  nombre_es: string;
  nivel: "Principiante" | "Intermedio" | "Avanzado" | "Profesional" | "Por revisar";
  tipo: string;
  familia: string;
  programa_base: boolean;
  prerrequisitos_sugeridos: string[];
};

function toCatalogLevel(title: string | null | undefined) {
  const normalized = (title ?? "").toLowerCase();
  if (normalized.includes("avanz")) return "Avanzado";
  if (normalized.includes("inter")) return "Intermedio";
  return "Principiante";
}

export default async function StudentFiguresPage() {
  const { snapshot, supabase, membership } = await getStudentPortalContext();
  const studentId = snapshot.profile.student_id;

  const { data: poleDiscipline } = await supabase
    .from("disciplines")
    .select("id,name")
    .eq("studio_id", membership.studio_id)
    .ilike("name", "Pole Fitness")
    .eq("active", true)
    .maybeSingle();

  if (!poleDiscipline) {
    return (
      <main className="space-y-4 pb-4 sm:space-y-5">
        <header>
          <p className="sendero-brand">Figuras</p>
          <h1 className="mt-2 text-4xl tracking-tight text-[var(--sendero-ink)] sm:text-5xl">
            Mi progreso de Pole
          </h1>
        </header>
        <section className="sendero-surface p-5 text-sm text-[var(--sendero-muted)]">
          Pole Fitness todavía no está configurado para tu estudio.
        </section>
      </main>
    );
  }

  const { data: studentLevel } = await supabase
    .from("student_discipline_levels")
    .select("discipline_technical_level_id")
    .eq("studio_id", membership.studio_id)
    .eq("student_id", studentId)
    .eq("discipline_id", poleDiscipline.id)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  let currentLevelTitle = "Principiante";

  if (studentLevel?.discipline_technical_level_id) {
    const { data: disciplineLevel } = await supabase
      .from("discipline_technical_levels")
      .select("technical_level_id")
      .eq("studio_id", membership.studio_id)
      .eq("id", studentLevel.discipline_technical_level_id)
      .maybeSingle();

    if (disciplineLevel?.technical_level_id) {
      const { data: levelDefinition } = await supabase
        .from("technical_level_definitions")
        .select("title")
        .eq("studio_id", membership.studio_id)
        .eq("id", disciplineLevel.technical_level_id)
        .maybeSingle();

      if (levelDefinition?.title) currentLevelTitle = levelDefinition.title;
    }
  }

  const currentCatalogLevel = toCatalogLevel(currentLevelTitle);
  const [{ data: profiles }, { data: elements }, { data: achievements }] = await Promise.all([
    supabase
      .from("pole_figure_profiles")
      .select("element_id,slug,original_name")
      .eq("studio_id", membership.studio_id)
      .eq("discipline_id", poleDiscipline.id),
    supabase
      .from("technical_elements")
      .select("id,name")
      .eq("studio_id", membership.studio_id)
      .eq("discipline_id", poleDiscipline.id)
      .eq("active", true)
      .not("pole_catalog_slug", "is", null),
    supabase
      .from("student_pole_figure_achievements")
      .select("id,figure_element_id,photo_path,achieved_at")
      .eq("studio_id", membership.studio_id)
      .eq("student_id", studentId),
  ]);

  const sourceFigures = catalog.figuras as CatalogFigure[];
  const sourceBySlug = new Map(sourceFigures.map((figure) => [figure.id, figure]));
  const profileBySlug = new Map((profiles ?? []).map((profile) => [profile.slug, profile]));
  const slugByElementId = new Map((profiles ?? []).map((profile) => [profile.element_id, profile.slug]));
  const nameByElement = new Map((elements ?? []).map((item) => [item.id, item.name]));
  const achievementByElement = new Map(
    (achievements ?? []).map((item) => [item.figure_element_id, item]),
  );
  const achievedSlugs = new Set(
    (achievements ?? [])
      .map((item) => slugByElementId.get(item.figure_element_id))
      .filter((slug): slug is string => Boolean(slug)),
  );

  const levelFigures = sourceFigures.filter((figure) => figure.nivel === currentCatalogLevel);
  const done = levelFigures.filter((figure) => achievedSlugs.has(figure.id));
  const pending = levelFigures.filter((figure) => !achievedSlugs.has(figure.id));
  const ready = pending.filter(
    (figure) =>
      figure.prerrequisitos_sugeridos.length > 0 &&
      figure.prerrequisitos_sugeridos.every((slug) => achievedSlugs.has(slug)),
  );
  const free = pending.filter((figure) => figure.prerrequisitos_sugeridos.length === 0);
  const locked = pending.filter(
    (figure) =>
      figure.prerrequisitos_sugeridos.length > 0 &&
      !figure.prerrequisitos_sugeridos.every((slug) => achievedSlugs.has(slug)),
  );

  const signedPhotoByPath = new Map<string, string>();
  const photoPaths = (achievements ?? [])
    .map((item) => item.photo_path)
    .filter((value): value is string => Boolean(value));

  if (photoPaths.length) {
    const { data: signedPhotos } = await supabase.storage
      .from("pole-achievement-photos")
      .createSignedUrls(photoPaths, 60 * 30);

    for (const photo of signedPhotos ?? []) {
      if (photo.path && photo.signedUrl) signedPhotoByPath.set(photo.path, photo.signedUrl);
    }
  }

  const latestAchievement = [...(achievements ?? [])]
    .filter((item) => slugByElementId.has(item.figure_element_id))
    .sort((left, right) => String(right.achieved_at).localeCompare(String(left.achieved_at)))[0];
  const latestSlug = latestAchievement
    ? slugByElementId.get(latestAchievement.figure_element_id)
    : undefined;
  const latestFigure = latestSlug ? sourceBySlug.get(latestSlug) : undefined;

  function figureName(figure: CatalogFigure) {
    const elementId = profileBySlug.get(figure.id)?.element_id;
    return (elementId && nameByElement.get(elementId)) || figure.nombre_es || figure.nombre;
  }

  function figureCard(figure: CatalogFigure, state: "done" | "ready" | "free" | "locked") {
    const profile = profileBySlug.get(figure.id);
    if (!profile) return null;
    const achievement = achievementByElement.get(profile.element_id);
    const photoUrl =
      achievement?.photo_path && signedPhotoByPath.get(achievement.photo_path);
    const missing = figure.prerrequisitos_sugeridos.filter((slug) => !achievedSlugs.has(slug));

    return (
      <article
        key={figure.id}
        className="sendero-surface overflow-hidden border border-white/[0.06]"
      >
        {photoUrl ? (
          <div className="relative aspect-[4/3] overflow-hidden bg-black/20">
            <Image
              src={photoUrl}
              alt={figureName(figure)}
              fill
              unoptimized
              className="object-cover"
            />
          </div>
        ) : null}

        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <Link href={`/student/figuras/${figure.id}`} className="min-w-0">
              <h3 className="text-base font-semibold text-[var(--sendero-ink)]">
                {figureName(figure)}
              </h3>
              <p className="mt-0.5 text-xs text-zinc-500">{figure.nombre}</p>
            </Link>
            <span
              className={
                state === "done"
                  ? "rounded-full bg-[var(--sendero-mint-soft)] px-2.5 py-1 text-[10px] font-semibold text-[var(--sendero-mint)]"
                  : state === "locked"
                    ? "rounded-full bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold text-zinc-500"
                    : "rounded-full bg-[var(--sendero-moon-soft)] px-2.5 py-1 text-[10px] font-semibold text-[var(--sendero-moon)]"
              }
            >
              {state === "done"
                ? "Lograda ✓"
                : state === "locked"
                  ? "Bloqueada"
                  : state === "ready"
                    ? "Siguiente"
                    : "Disponible"}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-zinc-500">
            <span>{figure.tipo}</span>
            {figure.programa_base ? (
              <>
                <span>·</span>
                <span className="text-[var(--sendero-moon)]">Programa base</span>
              </>
            ) : null}
          </div>

          {state === "locked" && missing.length ? (
            <p className="mt-3 text-[11px] leading-5 text-zinc-500">
              Antes:{" "}
              {missing
                .map((slug) => sourceBySlug.get(slug))
                .filter((item): item is CatalogFigure => Boolean(item))
                .map(figureName)
                .join(", ")}
            </p>
          ) : null}

          {achievement ? (
            <PoleFigurePhotoPicker
              elementId={profile.element_id}
              hasPhoto={Boolean(achievement.photo_path)}
            />
          ) : (
            <p className="mt-3 text-[11px] leading-5 text-zinc-500">
              Tu instructora debe validar esta figura en clase antes de que puedas agregar una foto.
            </p>
          )}
        </div>
      </article>
    );
  }

  return (
    <main className="space-y-5 pb-4">
      <header>
        <p className="sendero-brand">Figuras</p>
        <h1 className="mt-2 text-4xl tracking-tight text-[var(--sendero-ink)] sm:text-5xl">
          Mi progreso de Pole
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--sendero-muted)]">
          Tu instructora valida tus logros durante la clase. Aquí ves tu camino y guardas las fotos
          de las figuras que ya conseguiste.
        </p>
      </header>

      <section className="sendero-surface overflow-hidden p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="sendero-eyebrow">Pole Fitness · {currentLevelTitle}</p>
            <div className="mt-2 flex items-end gap-2">
              <strong className="text-5xl font-medium tracking-tight text-[var(--sendero-ink)]">
                {done.length}
              </strong>
              <span className="pb-1 text-sm text-zinc-400">de {levelFigures.length} figuras</span>
            </div>
          </div>
          <div className="rounded-full bg-[var(--sendero-mint-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--sendero-mint)]">
            {Math.round((done.length / Math.max(levelFigures.length, 1)) * 100)}%
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-[var(--sendero-mint)]"
            style={{ width: `${Math.round((done.length / Math.max(levelFigures.length, 1)) * 100)}%` }}
          />
        </div>
      </section>

      {latestFigure ? (
        <section className="space-y-2">
          <div>
            <h2 className="text-xl text-[var(--sendero-ink)]">Tu logro más reciente</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Validado por tu instructora.</p>
          </div>
          {figureCard(latestFigure, "done")}
        </section>
      ) : null}

      {ready.length || free.length ? (
        <section className="space-y-2">
          <div>
            <h2 className="text-xl text-[var(--sendero-ink)]">Tus siguientes figuras</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Ya tienes el camino listo para intentar estas en clase.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[...ready, ...free].slice(0, 3).map((figure) =>
              figureCard(figure, ready.includes(figure) ? "ready" : "free"),
            )}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-xl text-[var(--sendero-ink)]">Todas mis figuras</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Logradas, disponibles y bloqueadas dentro de tu nivel.
            </p>
          </div>
          <Link href="/student/perfil" className="text-xs text-[var(--sendero-mint)]">
            Volver al perfil
          </Link>
        </div>

        <div className="space-y-4">
          {done.length ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-[var(--sendero-ink)]">
                Logradas ({done.length})
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {done.map((figure) => figureCard(figure, "done"))}
              </div>
            </div>
          ) : null}

          {ready.length || free.length ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-[var(--sendero-ink)]">
                Por intentar ({ready.length + free.length})
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {ready.map((figure) => figureCard(figure, "ready"))}
                {free.map((figure) => figureCard(figure, "free"))}
              </div>
            </div>
          ) : null}

          {locked.length ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-[var(--sendero-ink)]">
                Bloqueadas ({locked.length})
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {locked.map((figure) => figureCard(figure, "locked"))}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
