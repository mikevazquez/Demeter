import Image from "next/image";
import Link from "next/link";

import { getStudentPortalContext } from "@/lib/student/portal";

import PoleFigurePhotoPicker from "./PoleFigurePhotoPicker";

const levelRank: Record<string, number> = {
  principiante: 1,
  intermedio: 2,
  avanzado: 4,
  profesional: 5,
  por_revisar: 99,
};

const levelLabel: Record<string, string> = {
  principiante: "Principiante",
  intermedio: "Intermedio",
  avanzado: "Avanzado",
  profesional: "Profesional",
  por_revisar: "Por revisar",
};

export default async function StudentFiguresPage() {
  const { snapshot, studio, supabase, membership } = await getStudentPortalContext();
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
  let currentLevelOrder = 1;

  if (studentLevel?.discipline_technical_level_id) {
    const { data: disciplineLevel } = await supabase
      .from("discipline_technical_levels")
      .select("technical_level_id,discipline_order")
      .eq("studio_id", membership.studio_id)
      .eq("id", studentLevel.discipline_technical_level_id)
      .maybeSingle();

    if (disciplineLevel?.technical_level_id) {
      const { data: levelDefinition } = await supabase
        .from("technical_level_definitions")
        .select("title,level_order")
        .eq("studio_id", membership.studio_id)
        .eq("id", disciplineLevel.technical_level_id)
        .maybeSingle();

      if (levelDefinition) {
        currentLevelTitle = levelDefinition.title;
        currentLevelOrder = levelDefinition.level_order ?? disciplineLevel.discipline_order ?? 1;
      }
    }
  }

  const [{ data: profiles }, { data: elements }, { data: achievements }] = await Promise.all([
    supabase
      .from("pole_figure_profiles")
      .select(
        "element_id,slug,original_name,catalog_level,figure_type,family,in_core_program,sort_order",
      )
      .eq("studio_id", membership.studio_id)
      .eq("discipline_id", poleDiscipline.id)
      .order("sort_order"),
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

  const nameByElement = new Map((elements ?? []).map((item) => [item.id, item.name]));
  const achievementByElement = new Map(
    (achievements ?? []).map((item) => [item.figure_element_id, item]),
  );

  const eligibleFigures = (profiles ?? []).filter(
    (profile) => (levelRank[profile.catalog_level] ?? 99) <= currentLevelOrder,
  );
  const completedCount = eligibleFigures.filter((profile) =>
    achievementByElement.has(profile.element_id),
  ).length;
  const pendingCount = eligibleFigures.length - completedCount;

  const signedPhotoByPath = new Map<string, string>();
  const photoPaths = (achievements ?? [])
    .map((item) => item.photo_path)
    .filter((value): value is string => Boolean(value));

  if (photoPaths.length) {
    const { data: signedPhotos } = await supabase.storage
      .from("pole-achievement-photos")
      .createSignedUrls(photoPaths, 60 * 30);

    for (const photo of signedPhotos ?? []) {
      if (photo.path && photo.signedUrl) {
        signedPhotoByPath.set(photo.path, photo.signedUrl);
      }
    }
  }

  return (
    <main className="space-y-4 pb-4 sm:space-y-5">
      <header>
        <p className="sendero-brand">Figuras</p>
        <h1 className="mt-2 text-4xl tracking-tight text-[var(--sendero-ink)] sm:text-5xl">
          Mi progreso de Pole
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--sendero-muted)]">
          Tu instructora marca una figura como hecha durante la clase. Cuando quede registrada,
          puedes guardar aquí la foto que te tomaste ese día.
        </p>
      </header>

      <section className="sendero-surface grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
        <div>
          <p className="sendero-eyebrow">Nivel actual</p>
          <h2 className="mt-1 text-2xl text-[var(--sendero-ink)]">{currentLevelTitle}</h2>
          <p className="mt-1 text-xs text-[var(--sendero-muted)]">
            {eligibleFigures.length} figuras disponibles hasta tu nivel.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="rounded-[20px] bg-[var(--sendero-mint-soft)] px-4 py-3 text-center">
            <strong className="block text-xl text-[var(--sendero-mint)]">{completedCount}</strong>
            <span className="text-[10px] text-zinc-400">Hechas</span>
          </div>
          <div className="rounded-[20px] bg-[var(--sendero-moon-soft)] px-4 py-3 text-center">
            <strong className="block text-xl text-[var(--sendero-moon)]">{pendingCount}</strong>
            <span className="text-[10px] text-zinc-400">Pendientes</span>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-xl text-[var(--sendero-ink)]">Tus figuras</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Hechas y pendientes según tu nivel.</p>
          </div>
          <Link href="/student/perfil" className="text-xs text-[var(--sendero-mint)]">
            Volver al perfil
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {eligibleFigures.map((profile) => {
            const achievement = achievementByElement.get(profile.element_id);
            const photoUrl =
              achievement?.photo_path && signedPhotoByPath.get(achievement.photo_path);

            return (
              <article
                key={profile.element_id}
                className="sendero-surface overflow-hidden border border-white/[0.06]"
              >
                {photoUrl ? (
                  <div className="relative aspect-[4/3] overflow-hidden bg-black/20">
                    <Image
                      src={photoUrl}
                      alt={nameByElement.get(profile.element_id) ?? profile.original_name}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  </div>
                ) : null}

                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-[var(--sendero-ink)]">
                        {nameByElement.get(profile.element_id) ?? profile.original_name}
                      </h3>
                      <p className="mt-0.5 text-xs text-zinc-500">{profile.original_name}</p>
                    </div>
                    <span
                      className={
                        achievement
                          ? "rounded-full bg-[var(--sendero-mint-soft)] px-2.5 py-1 text-[10px] font-semibold text-[var(--sendero-mint)]"
                          : "rounded-full bg-[var(--sendero-moon-soft)] px-2.5 py-1 text-[10px] font-semibold text-[var(--sendero-moon)]"
                      }
                    >
                      {achievement ? "Hecha" : "Pendiente"}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-zinc-500">
                    <span>{levelLabel[profile.catalog_level] ?? profile.catalog_level}</span>
                    <span>·</span>
                    <span>{profile.figure_type}</span>
                    {profile.in_core_program ? (
                      <>
                        <span>·</span>
                        <span className="text-[var(--sendero-moon)]">Programa base</span>
                      </>
                    ) : null}
                  </div>

                  {achievement ? (
                    <PoleFigurePhotoPicker
                      elementId={profile.element_id}
                      hasPhoto={Boolean(achievement.photo_path)}
                    />
                  ) : (
                    <p className="mt-3 text-[11px] leading-5 text-zinc-500">
                      Cuando tu instructora la marque como hecha podrás agregar tu foto.
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
