import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { createProduct } from "../actions";
import { ProductFormFields } from "../product-form-fields";

type CreationMode = "class_pack" | "restricted_pack" | "unlimited_membership" | "other";

const modeCards: Record<
  CreationMode,
  {
    title: string;
    description: string;
    icon: string;
    productType: string;
    unlimited: boolean;
    group: string;
    placeholder: string;
  }
> = {
  class_pack: {
    title: "Paquete por clases",
    description: "Define cuántas clases incluye y durante cuánto tiempo pueden utilizarse.",
    icon: "🎟️",
    productType: "package",
    unlimited: false,
    group: "class_packs",
    placeholder: "Ej. 12 clases · 30 días",
  },
  restricted_pack: {
    title: "Paquete restringido",
    description: "Limita el paquete a disciplinas, días y horarios recurrentes específicos.",
    icon: "🎯",
    productType: "package",
    unlimited: false,
    group: "restricted_packs",
    placeholder: "Ej. Pole lunes y miércoles 20:00",
  },
  unlimited_membership: {
    title: "Membresía ilimitada",
    description: "Acceso ilimitado durante una vigencia mensual, trimestral, anual o personalizada.",
    icon: "♾️",
    productType: "membership",
    unlimited: true,
    group: "unlimited_memberships",
    placeholder: "Ej. Ilimitado mensual",
  },
  other: {
    title: "Otro producto",
    description: "Clases sueltas, inscripciones u otros conceptos administrativos.",
    icon: "🧩",
    productType: "single_class",
    unlimited: false,
    group: "other",
    placeholder: "Ej. Clase suelta",
  },
};

function isCreationMode(value: string | undefined): value is CreationMode {
  return Boolean(value && value in modeCards);
}

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext("products.write");
  const mode = isCreationMode(params.mode) ? params.mode : null;

  if (!mode) {
    return (
      <main className="dashboard-shell admin-ux04-secondary-detail product-editor-page">
        <header>
          <p className="text-sm text-zinc-400">Productos</p>
          <h1 className="text-3xl font-semibold text-white">¿Qué quieres crear?</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            Elige la modalidad primero. Studio Flow mostrará únicamente las reglas que necesitas
            configurar para ese producto.
          </p>
        </header>

        <section className="grid gap-3 sm:grid-cols-2">
          {(Object.entries(modeCards) as [CreationMode, (typeof modeCards)[CreationMode]][]).map(
            ([key, config]) => (
              <Link
                key={key}
                href={`/admin/productos/nuevo?mode=${key}`}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-white no-underline transition hover:border-fuchsia-500/35 hover:bg-white/[0.05]"
              >
                <span
                  className="grid h-11 w-11 place-items-center rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/[0.08] text-xl"
                  aria-hidden="true"
                >
                  {config.icon}
                </span>
                <h2 className="mt-4 text-base font-semibold text-white">{config.title}</h2>
                <p className="mt-1 text-xs leading-5 text-zinc-400">{config.description}</p>
                <span className="mt-4 inline-flex text-xs font-semibold text-fuchsia-300">
                  Configurar →
                </span>
              </Link>
            ),
          )}
        </section>

        <div>
          <Link href="/admin/productos" className="text-xs font-semibold text-zinc-400 no-underline">
            ← Volver a productos
          </Link>
        </div>
      </main>
    );
  }

  const config = modeCards[mode];
  const [{ data: disciplines }, { data: schedules }, { data: templates }] = await Promise.all([
    ctx.supabase
      .from("disciplines")
      .select("id,name")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .order("name"),
    ctx.supabase
      .from("recurring_schedules")
      .select("id,weekday,local_time,template_id")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .order("weekday")
      .order("local_time"),
    ctx.supabase
      .from("class_templates")
      .select("id,name,discipline_id")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true),
  ]);

  const disciplineNames = new Map((disciplines ?? []).map((item) => [item.id, item.name]));
  const templateById = new Map((templates ?? []).map((item) => [item.id, item]));

  return (
    <main className="dashboard-shell admin-ux04-secondary-detail product-editor-page">
      <header>
        <Link
          href={`/admin/productos?group=${config.group}`}
          className="mb-2 inline-flex text-[10px] font-semibold text-zinc-400 no-underline hover:text-white"
        >
          ← {config.title}
        </Link>
        <p className="text-sm text-fuchsia-300">
          {config.icon} {config.title}
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-white">Nuevo</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-400">{config.description}</p>
      </header>

      <form
        action={createProduct}
        className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-7"
      >
        <label className="block text-sm text-zinc-300">
          Nombre
          <input
            name="name"
            required
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            placeholder={config.placeholder}
          />
        </label>

        <ProductFormFields
          disciplines={disciplines ?? []}
          schedules={(schedules ?? []).map((item) => ({
            id: item.id,
            weekday: item.weekday,
            localTime: item.local_time,
            activity: templateById.get(item.template_id)?.name ?? "Clase",
            discipline:
              disciplineNames.get(templateById.get(item.template_id)?.discipline_id ?? "") ??
              "Sin disciplina",
          }))}
          creationMode={mode}
          initialProductType={config.productType}
          initialUnlimited={config.unlimited}
        />

        <label className="block text-sm text-zinc-300">
          Descripción
          <textarea
            name="description"
            rows={3}
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
          />
        </label>

        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-xl bg-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500"
          >
            {mode === "unlimited_membership" ? "Crear membresía" : "Crear producto"}
          </button>
        </div>
      </form>
    </main>
  );
}
