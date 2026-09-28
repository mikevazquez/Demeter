import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";

type ProductGroup = "class_packs" | "restricted_packs" | "unlimited_memberships" | "other";

const labels: Record<string, string> = {
  package: "Paquete",
  membership: "Membresía",
  single_class: "Clase suelta",
  enrollment: "Inscripción",
  other: "Otro",
};

const groups: Record<
  ProductGroup,
  {
    title: string;
    description: string;
    icon: string;
    createLabel: string;
    createMode: string;
  }
> = {
  class_packs: {
    title: "Paquetes por clases",
    description: "Cantidad de clases + vigencia. Ej. 12 clases durante 30 días.",
    icon: "🎟️",
    createLabel: "Crear paquete",
    createMode: "class_pack",
  },
  restricted_packs: {
    title: "Paquetes restringidos",
    description: "Para disciplinas, días y horarios concretos. Ej. Pole lunes y miércoles 20:00.",
    icon: "🎯",
    createLabel: "Crear paquete",
    createMode: "restricted_pack",
  },
  unlimited_memberships: {
    title: "Membresías ilimitadas",
    description: "Acceso ilimitado durante una vigencia: mensual, trimestral, anual o personalizada.",
    icon: "♾️",
    createLabel: "Crear membresía",
    createMode: "unlimited_membership",
  },
  other: {
    title: "Otros productos",
    description: "Clases sueltas, inscripciones y otros conceptos que vende el estudio.",
    icon: "🧩",
    createLabel: "Crear producto",
    createMode: "other",
  },
};

function isProductGroup(value: string | undefined): value is ProductGroup {
  return Boolean(value && value in groups);
}

function classifyProduct(product: {
  product_type: string;
  unlimited: boolean;
  product_template_schedules?: { recurring_schedule_id: string }[] | null;
}): ProductGroup {
  const isPackageLike = product.product_type === "package" || product.product_type === "membership";

  if (isPackageLike && product.unlimited) return "unlimited_memberships";
  if (isPackageLike && (product.product_template_schedules?.length ?? 0) > 0) {
    return "restricted_packs";
  }
  if (isPackageLike) return "class_packs";
  return "other";
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; group?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext("products.read");
  const status = params.status === "inactive" ? "inactive" : "active";
  const selectedGroup = isProductGroup(params.group) ? params.group : null;

  const { data: products } = await ctx.supabase
    .from("product_templates")
    .select(
      "id,name,product_type,price_minor,currency,credit_limit,validity_days,unlimited,active,product_template_schedules(recurring_schedule_id)",
    )
    .eq("studio_id", ctx.studio.id)
    .eq("active", status === "active")
    .order("name");

  const groupedProducts = (products ?? []).reduce<Record<ProductGroup, typeof products>>(
    (acc, product) => {
      const group = classifyProduct(product);
      acc[group] = [...(acc[group] ?? []), product];
      return acc;
    },
    {
      class_packs: [],
      restricted_packs: [],
      unlimited_memberships: [],
      other: [],
    },
  );

  const visibleProducts = selectedGroup ? groupedProducts[selectedGroup] ?? [] : [];
  const selectedConfig = selectedGroup ? groups[selectedGroup] : null;
  const statusQuery = status === "inactive" ? "&status=inactive" : "";

  return (
    <main className="dashboard-shell admin-module-page admin-ux04-secondary">
      <header className="module-header">
        <div>
          {selectedGroup ? (
            <Link
              href={status === "inactive" ? "/admin/productos?status=inactive" : "/admin/productos"}
              className="mb-2 inline-flex text-[10px] font-semibold text-zinc-400 no-underline hover:text-white"
            >
              ← Productos
            </Link>
          ) : null}
          <h1>{selectedConfig?.title ?? "Productos y paquetes"}</h1>
          <p>
            {selectedConfig?.description ??
              "Organiza lo que vende el estudio por modalidad para configurarlo sin mezclar reglas."}
          </p>
        </div>
        {ctx.can("products.write") ? (
          <Link
            href={
              selectedConfig
                ? `/admin/productos/nuevo?mode=${selectedConfig.createMode}`
                : "/admin/productos/nuevo"
            }
            className="module-primary-action"
          >
            ＋ {selectedConfig?.createLabel ?? "Nuevo"}
          </Link>
        ) : null}
      </header>

      <nav className="module-tabs" aria-label="Estado de productos">
        <Link
          className={status === "active" ? "is-active" : ""}
          href={selectedGroup ? `/admin/productos?group=${selectedGroup}` : "/admin/productos"}
        >
          Activos
        </Link>
        <Link
          className={status === "inactive" ? "is-active" : ""}
          href={
            selectedGroup
              ? `/admin/productos?group=${selectedGroup}&status=inactive`
              : "/admin/productos?status=inactive"
          }
        >
          Inactivos
        </Link>
      </nav>

      {!selectedGroup ? (
        <section className="grid gap-3 sm:grid-cols-2">
          {(Object.entries(groups) as [ProductGroup, (typeof groups)[ProductGroup]][]).map(
            ([key, config]) => (
              <Link
                key={key}
                href={`/admin/productos?group=${key}${statusQuery}`}
                className="group rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left text-white no-underline transition hover:border-fuchsia-500/35 hover:bg-white/[0.05]"
              >
                <div className="flex items-start justify-between gap-4">
                  <span
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/[0.08] text-xl"
                    aria-hidden="true"
                  >
                    {config.icon}
                  </span>
                  <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold text-zinc-400">
                    {(groupedProducts[key] ?? []).length}{" "}
                    {(groupedProducts[key] ?? []).length === 1 ? "producto" : "productos"}
                  </span>
                </div>
                <h2 className="mt-4 text-base font-semibold text-white">{config.title}</h2>
                <p className="mt-1 text-xs leading-5 text-zinc-400">{config.description}</p>
                <span className="mt-4 inline-flex text-xs font-semibold text-fuchsia-300">
                  Ver {status === "active" ? "activos" : "inactivos"} →
                </span>
              </Link>
            ),
          )}
        </section>
      ) : !visibleProducts.length ? (
        <section className="module-empty">
          {status === "active"
            ? `Aún no hay ${selectedConfig?.title.toLowerCase()} activos.`
            : `No hay ${selectedConfig?.title.toLowerCase()} inactivos.`}
        </section>
      ) : (
        <section className="module-list">
          {visibleProducts.map((product) => (
            <Link
              key={product.id}
              href={`/admin/productos/${product.id}`}
              className="module-list-row product-list-row"
            >
              <span className="module-row-icon" aria-hidden="true">
                {selectedConfig?.icon ?? "▣"}
              </span>
              <span className="module-row-copy">
                <strong>{product.name}</strong>
                <small>
                  {labels[product.product_type] ?? product.product_type} ·{" "}
                  {product.validity_days == null
                    ? "Vitalicia"
                    : `Vigencia ${product.validity_days} días`}
                  {selectedGroup === "restricted_packs" ? " · Horarios específicos" : ""}
                </small>
              </span>
              <span className="module-row-meta">
                <strong>
                  {new Intl.NumberFormat("es-MX", {
                    style: "currency",
                    currency: product.currency,
                  }).format(product.price_minor / 100)}
                </strong>
                <small>
                  {product.product_type === "enrollment"
                    ? "Derecho administrativo"
                    : product.unlimited
                      ? "Ilimitado"
                      : `${product.credit_limit} créditos`}
                </small>
              </span>
              <span className="module-chevron" aria-hidden="true">
                ›
              </span>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
