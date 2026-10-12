import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("POLE-FIGURAS-01 · contrato del módulo", () => {
  const migration = source("supabase/migrations/20261012220000_pole_figures_module.sql");
  const sessionPage = source("app/admin/agenda/[sessionId]/page.tsx");
  const planner = source("app/admin/agenda/[sessionId]/PolePlanner.tsx");
  const studentApp = source("app/student/perfil/figuras/PoleFiguresApp.tsx");
  const studentActions = source("app/student/perfil/figuras/actions.ts");
  const profilePage = source("app/student/perfil/page.tsx");

  const tables = [
    "pole_figure_profiles",
    "pole_figure_prerequisites",
    "pole_level_map",
    "student_pole_achievements",
    "student_pole_authorizations",
    "pole_achievement_events",
    "class_session_pole_plans",
  ];

  it("crea las tablas con RLS forzado y sin permisos para anon", () => {
    for (const table of tables) {
      expect(migration).toContain(`create table public.${table} (`);
      expect(migration).toContain(`alter table public.${table} enable row level security;`);
      expect(migration).toContain(`alter table public.${table} force row level security;`);
      expect(migration).toContain(`revoke all on public.${table} from anon, authenticated;`);
    }
    expect(migration).not.toMatch(/grant [^;]* to anon/);
    expect(migration).not.toMatch(/grant [^;]* to public/i);
  });

  it("las alumnas sólo escriben por RPC con validación en servidor", () => {
    expect(migration).toContain(
      "grant select on public.student_pole_achievements to authenticated;",
    );
    expect(migration).not.toMatch(/grant [^;]*insert[^;]*student_pole_achievements/);
    for (const rpc of [
      "student_pole_figures",
      "student_mark_pole_figure",
      "student_unmark_pole_figure",
      "student_set_pole_photo",
      "staff_save_pole_plan",
      "staff_validate_pole_figures",
      "staff_set_pole_authorization",
      "admin_import_pole_catalog",
    ]) {
      expect(migration).toContain(`create or replace function public.${rpc}(`);
    }
    expect(migration).toContain("private.pole_mark_block_reason");
    expect(migration).toContain("'pole_figure_requires_authorization'");
    expect(migration).toContain("'pole_figure_prerequisites_missing'");
    expect(migration).toContain("'pole_prerequisite_cycle'");
  });

  it("todas las funciones security definer fijan search_path vacío", () => {
    const definers = migration.match(/^security definer\nset search_path = ''$/gm) ?? [];
    const total = migration.match(/^security definer$/gm) ?? [];
    expect(total.length).toBeGreaterThan(10);
    expect(definers.length).toBe(total.length);
  });

  it("mapea niveles como acordó el estudio", () => {
    expect(migration).toContain("when p_level_key = 'beginner' then 'principiante'");
    expect(migration).toContain(
      "when p_level_key in ('intermediate', 'upper_intermediate') then 'intermedio'",
    );
    expect(migration).toContain("when p_level_key in ('advanced', 'elite') then 'avanzado'");
    expect(migration).toContain("p_level_key in ('advanced', 'elite');");
  });

  it("las fotos viven en un bucket privado por carpeta de usuaria", () => {
    expect(migration).toContain("'pole-achievement-photos',\n  false,");
    expect(migration).toContain("(storage.foldername(name))[1] = (select auth.uid())::text");
    expect(studentActions).toContain("student_set_pole_photo");
  });

  it("el detalle de sesión muestra el planificador sólo con permiso de evaluaciones", () => {
    expect(sessionPage).toContain("<PoleClassPanel");
    expect(sessionPage).toContain("CAPABILITIES.EVALUATIONS_READ");
    expect(planner).toContain("Usar en clase");
    expect(planner).toContain("Al terminar la clase");
    expect(planner).toContain("Autorizar figuras Profesional");
    expect(planner).toContain("Nunca entran a los combos.");
  });

  it("el portal de alumna tiene inicio, lista con 3 pestañas y detalle con cadena", () => {
    expect(profilePage).toContain('href="/student/perfil/figuras"');
    for (const copy of [
      "Ver todas mis figuras",
      "Lo que lograste hoy",
      "Tus siguientes figuras",
      "Siguientes para ti",
      "También puedes intentar",
      "Bloqueadas",
      "Requieren autorización",
      "Tu camino hacia esta figura",
      "Sube tu foto haciéndola",
      "Mi galería",
    ]) {
      expect(studentApp).toContain(copy);
    }
    // Sin imágenes de catálogo: la única imagen es la foto propia de la alumna.
    expect(studentApp).not.toContain("/disciplinas/");
  });
});
