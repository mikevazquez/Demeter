import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = read("supabase/migrations/20261022215000_neb01_platform_console_reads.sql");

describe("NEB-01-10/11/12 consola de Nébora", () => {
  it("cada lectura pública exige ser plataforma y no se abre a anon", () => {
    for (const fn of ["platform_overview()", "platform_list_studios()", "platform_studio_detail(uuid)"]) {
      expect(migration).toContain(`revoke all on function public.${fn} from public, anon;`);
      expect(migration).toContain(`grant execute on function public.${fn} to authenticated;`);
    }
    const publicBodies = migration.split("create or replace function public.").slice(1);
    expect(publicBodies).toHaveLength(3);
    for (const body of publicBodies) {
      expect(body).toContain("perform private.platform_require_admin();");
      expect(body).toContain("security definer\nset search_path = ''");
    }
  });

  it("la migración solo lee: no inserta, actualiza ni borra", () => {
    expect(migration).not.toMatch(/\b(insert into|update public\.|delete from)\b/i);
  });

  it("los estados de reserva se comparan como texto (enum reservation_status)", () => {
    expect(migration).toContain("r.status::text like 'cancelled%'");
    expect(migration).not.toMatch(/r\.status (=|<>) 'cancelled'/);
  });

  it("la consola vive fuera de /admin y responde 404 a quien no es plataforma", () => {
    const layout = read("app/plataforma/layout.tsx");
    expect(layout).toContain("isPlatformAdmin(supabase)");
    expect(layout).toContain("notFound()");
    expect(layout).toContain('createClient("admin")');
  });

  it("las acciones solo llaman a las funciones auditadas de plataforma", () => {
    const actions = read("app/plataforma/actions.ts");
    expect(actions).toContain('"use server"');
    for (const rpc of ["platform_set_studio_plan", "platform_set_studio_module", "platform_set_studio_status"]) {
      expect(actions).toContain(`rpc("${rpc}"`);
    }
    expect(actions).not.toMatch(/\.from\(/);
  });

  it("interpreta las lecturas y tolera datos faltantes", async () => {
    const { parseOverview, parseStudioDetail, parseStudioRows, formatUsdMicros, formatMinorMxn } =
      await import("../lib/platform/console");
    expect(parseOverview(null)).toBeNull();
    expect(
      parseOverview({
        studios_total: 2,
        studios_by_status: { active: 1, internal: 1 },
        mrr_mxn: 899,
        founding_used: 0,
        founding_seats: 5,
        students_active: 3,
        pending_requests: 2,
      }),
    ).toMatchObject({ studiosTotal: 2, mrrMxn: 899, studiosByStatus: { active: 1 }, pendingRequests: 2 });

    expect(parseStudioRows("x")).toEqual([]);
    expect(
      parseStudioRows([{ id: "a", name: "Aurora Pilates", brand_name: "Aurora", plan: "core", status: "active", monthly_price_mxn: 899, founding_month: null, cut_day: 5 }])[0],
    ).toMatchObject({ brandName: "Aurora", monthlyPriceMxn: 899, foundingMonth: null, cutDay: 5 });

    const detail = parseStudioDetail({
      studio: { id: "a", name: "Aurora Pilates", brand_name: "Aurora", slug: "aurora" },
      entitlements: { studio_id: "a", plan: "core", plan_label: "Core", status: "active", brand_level: "powered", can_operate: true, monthly_price_mxn: 899, founding_alumni: false, founding_started_on: null, founding_ends_on: null, cut_day: 5, modules: { catalogo: true } },
      students: { total: 3, active: 2, new_this_month: 1 },
      demi_month: { calls: 2, input_tokens: 1500, output_tokens: 300, cost_usd_micros: 4500 },
      pending_requests: [{ module: "recursos", requested_at: "2026-10-22T10:00:00Z" }],
    });
    expect(detail?.entitlements?.modules).toEqual({ recompensas: false, recursos: false, catalogo: true, demi: false });
    expect(detail?.students.active).toBe(2);
    expect(detail?.salesMonth).toEqual({ count: 0, totalMinor: 0 });
    expect(detail?.pendingRequests[0].module).toBe("recursos");
    expect(formatUsdMicros(4500)).toBe("US$0.00");
    expect(formatUsdMicros(1_234_567)).toBe("US$1.23");
    expect(formatMinorMxn(120000)).toContain("1,200");
  });
});
