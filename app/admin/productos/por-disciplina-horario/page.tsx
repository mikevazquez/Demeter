import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";

function DisciplineIcon() {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="7" r="3" />
      <path d="M5 20c.8-4.6 3.2-7 7-7s6.2 2.4 7 7" />
    </svg>
  );
}

function ScheduleIcon() {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export default async function DisciplineSchedulePackagesPage() {
  const ctx = await getAdminContext("products.read");

  const [{ data: disciplines }, { data: rows }] = await Promise.all([
    ctx.supabase.from("disciplines").select("id").eq("studio_id", ctx.studio.id).eq("active", true),
    ctx.supabase
      .from("product_templates")
      .select("id")
      .eq("studio_id", ctx.studio.id)
      .eq("product_type", "package")
      .eq("unlimited", false)
      .eq("active", true),
  ]);

  const productIds = (rows ?? []).map((product) => product.id);
  const [{ data: disciplineLinks }, { data: scheduleLinks }] = productIds.length
    ? await Promise.all([
        ctx.supabase
          .from("product_template_disciplines")
          .select("product_template_id,discipline_id")
          .eq("studio_id", ctx.studio.id)
          .in("product_template_id", productIds),
        ctx.supabase
          .from("product_template_schedules")
          .select("product_template_id")
          .eq("studio_id", ctx.studio.id)
          .in("product_template_id", productIds),
      ])
    : [{ data: [] }, { data: [] }];

  const activeDisciplineIds = new Set((disciplines ?? []).map((item) => item.id));
  const disciplinesByProduct = new Map<string, Set<string>>();
  for (const link of disciplineLinks ?? []) {
    const current = disciplinesByProduct.get(link.product_template_id) ?? new Set<string>();
    current.add(link.discipline_id);
    disciplinesByProduct.set(link.product_template_id, current);
  }

  const scheduleRestrictedProductIds = new Set(
    (scheduleLinks ?? []).map((link) => link.product_template_id),
  );

  let disciplineCount = 0;
  let scheduleCount = 0;

  for (const product of rows ?? []) {
    if (scheduleRestrictedProductIds.has(product.id)) {
      scheduleCount += 1;
      continue;
    }

    const linked = disciplinesByProduct.get(product.id) ?? new Set<string>();
    const appliesToAll =
      activeDisciplineIds.size > 0 &&
      [...activeDisciplineIds].every((disciplineId) => linked.has(disciplineId));

    if (linked.size > 0 && !appliesToAll) disciplineCount += 1;
  }

  return (
    <main className="packages-v2">
      <header className="packages-v2-header">
        <Link href="/admin/productos" className="packages-v2-back">
          <span aria-hidden="true">←</span> Paquetes
        </Link>
        <h1>Por disciplina / horario</h1>
        <p>Elige qué tipo de restricción quieres administrar.</p>
      </header>

      <section className="packages-v2-info" aria-label="Cómo funcionan las restricciones">
        <span className="packages-v2-info-icon" aria-hidden="true">
          i
        </span>
        <p>
          Aquí separas paquetes que sirven para ciertas disciplinas de los que solo sirven en
          horarios concretos.
        </p>
      </section>

      <section className="package-category-grid" aria-label="Tipos de restricción">
        <Link
          href="/admin/productos/por-disciplina-horario/disciplina"
          className="package-category-card"
        >
          <span className="package-category-icon">
            <DisciplineIcon />
          </span>
          <span className="package-category-copy">
            <strong>Por disciplina</strong>
            <span>Ej. Solo Pole Fitness, Exotic o Aro.</span>
            <small className="package-period-count">
              {disciplineCount} {disciplineCount === 1 ? "paquete activo" : "paquetes activos"}
            </small>
          </span>
          <span className="package-category-action">
            Ver <span aria-hidden="true">›</span>
          </span>
        </Link>

        <Link
          href="/admin/productos/por-disciplina-horario/horario"
          className="package-category-card is-blue"
        >
          <span className="package-category-icon">
            <ScheduleIcon />
          </span>
          <span className="package-category-copy">
            <strong>Por horarios específicos</strong>
            <span>Ej. Solo sábados y domingos o una clase concreta.</span>
            <small className="package-period-count">
              {scheduleCount} {scheduleCount === 1 ? "paquete activo" : "paquetes activos"}
            </small>
          </span>
          <span className="package-category-action">
            Ver <span aria-hidden="true">›</span>
          </span>
        </Link>
      </section>
    </main>
  );
}
