import Link from "next/link";
import { notFound } from "next/navigation";

import catalog from "@/app/admin/catalogo/pole-catalog-data.json";
import { getStudentPortalContext } from "@/lib/student/portal";

type CatalogFigure = {
  id: string;
  nombre: string;
  nombre_es: string;
  nivel: "Principiante" | "Intermedio" | "Avanzado" | "Profesional" | "Por revisar";
  tipo: string;
  familia: string;
  prerrequisitos_sugeridos: string[];
};

export default async function StudentPoleFigureDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const [{ slug }, { snapshot, supabase, membership }] = await Promise.all([
    params,
    getStudentPortalContext(),
  ]);

  const figures = catalog.figuras as CatalogFigure[];
  const bySlug = new Map(figures.map((figure) => [figure.id, figure]));
  const figure = bySlug.get(slug);
  if (!figure) notFound();

  const { data: poleDiscipline } = await supabase
    .from("disciplines")
    .select("id")
    .eq("studio_id", membership.studio_id)
    .ilike("name", "Pole Fitness")
    .eq("active", true)
    .maybeSingle();

  if (!poleDiscipline) notFound();

  const [{ data: profiles }, { data: elements }, { data: achievements }] = await Promise.all([
    supabase
      .from("pole_figure_profiles")
      .select("element_id,slug")
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
      .select("figure_element_id")
      .eq("studio_id", membership.studio_id)
      .eq("student_id", snapshot.profile.student_id),
  ]);

  const profileBySlug = new Map((profiles ?? []).map((item) => [item.slug, item]));
  const slugByElementId = new Map((profiles ?? []).map((item) => [item.element_id, item.slug]));
  const nameByElement = new Map((elements ?? []).map((item) => [item.id, item.name]));
  const achievedSlugs = new Set(
    (achievements ?? [])
      .map((item) => slugByElementId.get(item.figure_element_id))
      .filter((item): item is string => Boolean(item)),
  );

  const name = (item: CatalogFigure) => {
    const elementId = profileBySlug.get(item.id)?.element_id;
    return (elementId && nameByElement.get(elementId)) || item.nombre_es || item.nombre;
  };

  const achieved = achievedSlugs.has(figure.id);
  const missing = figure.prerrequisitos_sugeridos.filter((item) => !achievedSlugs.has(item));
  const children = figures.filter((item) => item.prerrequisitos_sugeridos.includes(figure.id));

  function collectAncestors(target: CatalogFigure, seen = new Set<string>()): CatalogFigure[] {
    const result: CatalogFigure[] = [];
    for (const prerequisite of target.prerrequisitos_sugeridos) {
      if (seen.has(prerequisite)) continue;
      seen.add(prerequisite);
      const parent = bySlug.get(prerequisite);
      if (!parent) continue;
      result.push(...collectAncestors(parent, seen), parent);
    }
    return result.filter(
      (item, index, array) => array.findIndex((other) => other.id === item.id) === index,
    );
  }

  const ancestors = collectAncestors(figure);

  return (
    <main className="space-y-5 pb-4">
      <Link href="/student/figuras" className="text-xs text-[var(--sendero-mint)]">
        ← Volver a Mis figuras
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <span
            className={
              achieved
                ? "rounded-full bg-[var(--sendero-mint-soft)] px-2.5 py-1 text-[10px] font-semibold text-[var(--sendero-mint)]"
                : missing.length
                  ? "rounded-full bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold text-zinc-500"
                  : "rounded-full bg-[var(--sendero-moon-soft)] px-2.5 py-1 text-[10px] font-semibold text-[var(--sendero-moon)]"
            }
          >
            {achieved ? "Lograda ✓" : missing.length ? "Bloqueada" : "Disponible"}
          </span>
          <span className="rounded-full bg-white/[0.04] px-2.5 py-1 text-[10px] text-zinc-400">
            {figure.nivel}
          </span>
          <span className="rounded-full bg-white/[0.04] px-2.5 py-1 text-[10px] text-zinc-400">
            {figure.tipo}
          </span>
        </div>
        <h1 className="text-4xl tracking-tight text-[var(--sendero-ink)] sm:text-5xl">
          {name(figure)}
        </h1>
        <p className="text-sm text-zinc-500">{figure.nombre}</p>
      </header>

      {!achieved && missing.length ? (
        <section className="sendero-surface p-5">
          <p className="sendero-eyebrow">Antes de esta figura</p>
          <p className="mt-2 text-sm leading-6 text-[var(--sendero-muted)]">
            Primero necesitas lograr{" "}
            <strong className="text-[var(--sendero-ink)]">
              {missing
                .map((item) => bySlug.get(item))
                .filter((item): item is CatalogFigure => Boolean(item))
                .map(name)
                .join(" y ")}
            </strong>
            .
          </p>
        </section>
      ) : null}

      <section className="sendero-surface p-5">
        <p className="sendero-eyebrow">Tu camino hacia esta figura</p>
        <div className="mt-4 space-y-2">
          {ancestors.length ? (
            ancestors.map((item) => (
              <Link
                href={`/student/figuras/${item.id}`}
                key={item.id}
                className="flex items-center gap-3 rounded-[18px] border border-white/[0.06] bg-white/[0.02] px-4 py-3"
              >
                <span
                  className={
                    achievedSlugs.has(item.id)
                      ? "grid h-7 w-7 place-items-center rounded-full bg-[var(--sendero-mint)] text-xs font-bold text-[#1d1e23]"
                      : "grid h-7 w-7 place-items-center rounded-full border border-[var(--sendero-mint)] text-xs text-[var(--sendero-mint)]"
                  }
                >
                  {achievedSlugs.has(item.id) ? "✓" : "·"}
                </span>
                <div className="min-w-0">
                  <strong className="block text-sm text-[var(--sendero-ink)]">{name(item)}</strong>
                  <span className="text-[11px] text-zinc-500">
                    {item.nivel} · {item.tipo}
                  </span>
                </div>
              </Link>
            ))
          ) : (
            <p className="text-sm text-zinc-500">
              Esta figura no necesita otra figura previa del catálogo.
            </p>
          )}

          <div className="flex items-center gap-3 rounded-[18px] bg-[var(--sendero-mint-soft)] px-4 py-3">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--sendero-mint)] text-xs font-bold text-[#1d1e23]">
              {achieved ? "✓" : "·"}
            </span>
            <div>
              <strong className="block text-sm text-[var(--sendero-ink)]">{name(figure)}</strong>
              <span className="text-[11px] text-zinc-500">Figura actual</span>
            </div>
          </div>
        </div>
      </section>

      {children.length ? (
        <section className="sendero-surface p-5">
          <p className="sendero-eyebrow">
            {achieved ? "Esta figura te abrió" : "Cuando la logres, se abren"}
          </p>
          <div className="mt-4 space-y-2">
            {children.map((item) => (
              <Link
                href={`/student/figuras/${item.id}`}
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-[18px] border border-white/[0.06] bg-white/[0.02] px-4 py-3"
              >
                <div>
                  <strong className="block text-sm text-[var(--sendero-ink)]">{name(item)}</strong>
                  <span className="text-[11px] text-zinc-500">
                    {item.nivel} · {item.tipo}
                  </span>
                </div>
                <span className="text-[var(--sendero-mint)]">›</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
