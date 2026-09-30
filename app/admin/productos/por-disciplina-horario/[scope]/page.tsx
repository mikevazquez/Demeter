import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";

type ScopeKey = "disciplina" | "horario";

const scopes: Record<ScopeKey, { title: string; description: string }> = {
  disciplina: {
    title: "Por disciplina",
    description: "Paquetes que aplican solo a ciertas disciplinas.",
  },
  horario: {
    title: "Por horarios específicos",
    description: "Paquetes que aplican solo a horarios concretos.",
  },
};

const weekdayLabels: Record<number, string> = {
  0: "Dom",
  1: "Lun",
  2: "Mar",
  3: "Mié",
  4: "Jue",
  5: "Vie",
  6: "Sáb",
};

function isScopeKey(value: string): value is ScopeKey {
  return value === "disciplina" || value === "horario";
}

function TicketIcon() {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H19v4a3 3 0 0 0 0 6v4H6.5A2.5 2.5 0 0 1 4 16.5V7.5Z" />
      <path d="M9 8v8" strokeDasharray="2 2" />
    </svg>
  );
}

export default async function RestrictedPackageListPage({
  params,
}: {
  params: Promise<{ scope: string }>;
}) {
  const { scope: rawScope } = await params;
  if (!isScopeKey(rawScope)) notFound();

  const scope = scopes[rawScope];
  const ctx = await getAdminContext("products.read");

  const [
    { data: disciplines },
    { data: rows },
    { data: schedules },
    { data: templates },
  ] = await Promise.all([
    ctx.supabase
      .from("disciplines")
      .select("id,name")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .order("name"),
    ctx.supabase
      .from("product_templates")
      .select("id,name,price_minor,currency,credit_limit,validity_days,package_term,active")
      .eq("studio_id", ctx.studio.id)
      .eq("product_type", "package")
      .eq("unlimited", false)
      .eq("active", true)
      .order("name"),
    ctx.supabase
      .from("recurring_schedules")
      .select("id,weekday,local_time,template_id")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true),
    ctx.supabase
      .from("class_templates")
      .select("id,name,discipline_id")
      .eq("studio_id", ctx.studio.id)
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
          .select("product_template_id,recurring_schedule_id")
          .eq("studio_id", ctx.studio.id)
          .in("product_template_id", productIds),
      ])
    : [{ data: [] }, { data: [] }];

  const disciplineNameById = new Map((disciplines ?? []).map((item) => [item.id, item.name]));
  const templateById = new Map((templates ?? []).map((item) => [item.id, item]));
  const scheduleById = new Map((schedules ?? []).map((item) => [item.id, item]));
  const activeDisciplineIds = new Set((disciplines ?? []).map((item) => item.id));

  const disciplinesByProduct = new Map<string, string[]>();
  for (const link of disciplineLinks ?? []) {
    const current = disciplinesByProduct.get(link.product_template_id) ?? [];
    current.push(link.discipline_id);
    disciplinesByProduct.set(link.product_template_id, current);
  }

  const schedulesByProduct = new Map<string, string[]>();
  for (const link of scheduleLinks ?? []) {
    const current = schedulesByProduct.get(link.product_template_id) ?? [];
    current.push(link.recurring_schedule_id);
    schedulesByProduct.set(link.product_template_id, current);
  }

  const products = (rows ?? []).filter((product) => {
    const disciplineIds = disciplinesByProduct.get(product.id) ?? [];
    const scheduleIds = schedulesByProduct.get(product.id) ?? [];
    const appliesToAllDisciplines =
      activeDisciplineIds.size > 0 &&
      [...activeDisciplineIds].every((disciplineId) => disciplineIds.includes(disciplineId));

    if (rawScope === "horario") return scheduleIds.length > 0;
    return scheduleIds.length === 0 && disciplineIds.length > 0 && !appliesToAllDisciplines;
  });

  return (
    <main className="packages-v2">
      <header className="packages-v2-header">
        <Link href="/admin/productos/por-disciplina-horario" className="packages-v2-back">
          <span aria-hidden="true">←</span> Disciplina / horario
        </Link>
        <h1>{scope.title}</h1>
        <p>{scope.description}</p>
      </header>

      <section className="packages-v2-info is-green" aria-label="Paquetes activos">
        <span className="packages-v2-info-icon" aria-hidden="true">
          i
        </span>
        <p>Aquí ves únicamente los paquetes activos de este tipo.</p>
      </section>

      {products.length ? (
        <section className="package-list" aria-label={scope.title}>
          {products.map((product) => {
            const money = new Intl.NumberFormat(ctx.studio.locale, {
              style: "currency",
              currency: product.currency,
              maximumFractionDigits: 0,
            });
            const disciplineIds = disciplinesByProduct.get(product.id) ?? [];
            const scheduleIds = schedulesByProduct.get(product.id) ?? [];

            const disciplineLabels = disciplineIds
              .map((id) => disciplineNameById.get(id))
              .filter(Boolean) as string[];

            const scheduleLabels = scheduleIds
              .map((id) => {
                const schedule = scheduleById.get(id);
                if (!schedule) return null;
                const template = templateById.get(schedule.template_id);
                return `${weekdayLabels[schedule.weekday] ?? ""} ${schedule.local_time.slice(
                  0,
                  5,
                )} · ${template?.name ?? "Clase"}`;
              })
              .filter(Boolean) as string[];

            const visibleLabels =
              rawScope === "horario" ? scheduleLabels.slice(0, 2) : disciplineLabels.slice(0, 3);
            const totalLabels =
              rawScope === "horario" ? scheduleLabels.length : disciplineLabels.length;
            const hiddenCount = Math.max(0, totalLabels - visibleLabels.length);

            return (
              <Link
                key={product.id}
                href={`/admin/productos/${product.id}`}
                className="package-list-card"
              >
                <span className="package-list-icon">
                  <TicketIcon />
                </span>

                <span className="package-list-main">
                  <span className="package-list-title-row">
                    <strong>{product.name}</strong>
                    <span className="package-list-price">
                      {money.format(product.price_minor / 100)}
                    </span>
                  </span>

                  <span className="package-chip-row">
                    {visibleLabels.map((label) => (
                      <span className="package-list-chip" key={label}>
                        {label}
                      </span>
                    ))}
                    {hiddenCount ? (
                      <span className="package-list-chip is-muted">+{hiddenCount}</span>
                    ) : null}
                  </span>

                  <span className="package-list-meta">
                    <span>
                      {product.credit_limit == null
                        ? "Sin límite definido"
                        : `${product.credit_limit} clases`}
                    </span>
                    <span>
                      {product.validity_days == null
                        ? "Sin vencimiento"
                        : `${product.validity_days} días`}
                    </span>
                  </span>
                </span>

                <span className="package-list-status">Activo</span>
              </Link>
            );
          })}
        </section>
      ) : (
        <section className="packages-v2-empty">Aún no hay paquetes activos de este tipo.</section>
      )}

      {ctx.can("products.write") ? (
        <Link
          href={`/admin/productos/por-disciplina-horario/nuevo?scope=${rawScope}`}
          className="packages-v2-primary"
        >
          <span aria-hidden="true">＋</span> Crear paquete
        </Link>
      ) : null}
    </main>
  );
}
