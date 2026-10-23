import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  baseItemHint,
  groupPersonalItems,
  joinFigureNames,
  portalChanges,
  readiness,
  shortDate,
  type PersonalItem,
} from "@/lib/evaluations/pole-adaptive";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const TODAY = "2026-10-20T15:00:00.000Z";

describe("EVALUACIONES-04 · lógica de la evaluación adaptativa", () => {
  it("distingue validada en clase reciente, marcada por ella, lograda y faltante", () => {
    expect(
      baseItemHint(
        {
          source: "instructor",
          achievedAt: "2026-10-15T18:00:00Z",
          validatedAt: "2026-10-15T18:00:00Z",
        },
        TODAY,
      ),
    ).toEqual({ kind: "recent_class", date: "2026-10-15T18:00:00Z", suggestedAttempts: 1 });
    expect(
      baseItemHint(
        {
          source: "instructor",
          achievedAt: "2026-08-01T18:00:00Z",
          validatedAt: "2026-08-01T18:00:00Z",
        },
        TODAY,
      ).kind,
    ).toBe("achieved");
    expect(
      baseItemHint(
        { source: "student", achievedAt: "2026-10-11T18:00:00Z", validatedAt: null },
        TODAY,
      ).kind,
    ).toBe("self_marked");
    expect(baseItemHint(null, TODAY)).toEqual({ kind: "missing" });
  });

  it("calcula qué cambia en el portal: valida, agrega y manda a practicar", () => {
    const changes = portalChanges([
      {
        elementId: "a",
        name: "Bumerán",
        status: "meets",
        achievement: { source: "student", achievedAt: TODAY, validatedAt: null },
      },
      { elementId: "b", name: "Invertida básica", status: "meets", achievement: null },
      { elementId: "c", name: "Giro attitude", status: "does_not_meet", achievement: null },
      {
        elementId: "d",
        name: "Silla",
        status: "meets",
        achievement: { source: "instructor", achievedAt: TODAY, validatedAt: TODAY },
      },
      { elementId: "e", name: "Cuna", status: "not_evaluated", achievement: null },
      { elementId: "b", name: "Invertida básica", status: "meets", achievement: null },
    ]);
    expect(changes.confirmed.map((ref) => ref.name)).toEqual(["Bumerán"]);
    expect(changes.added.map((ref) => ref.name)).toEqual(["Invertida básica"]);
    expect(changes.practice.map((ref) => ref.name)).toEqual(["Giro attitude"]);
  });

  it("preparación: lista, casi lista o le faltan figuras", () => {
    expect(readiness(8, 8)).toMatchObject({ percent: 100, verdict: "ready" });
    expect(readiness(7, 8)).toMatchObject({ percent: 88, verdict: "almost" });
    expect(readiness(5, 8)).toMatchObject({ percent: 63, verdict: "not_yet" });
    expect(readiness(0, 0)).toMatchObject({ percent: 0 });
  });

  it("agrupa la parte personalizada por motivo y formatea fechas y nombres", () => {
    const item = (id: string, reason: PersonalItem["reason"]) =>
      ({ id, reason }) as Pick<PersonalItem, "reason"> & { id: string };
    const groups = groupPersonalItems([
      item("1", "self_marked"),
      item("2", "next_level"),
      item("3", "self_marked"),
    ]);
    expect(groups.self_marked.map((entry) => entry.id)).toEqual(["1", "3"]);
    expect(groups.pending_previous).toEqual([]);
    expect(shortDate("2026-10-16T03:00:00Z")).toBe("15 oct");
    expect(
      joinFigureNames([
        { elementId: "1", name: "Silla" },
        { elementId: "2", name: "Cuna" },
        { elementId: "3", name: "Carrusel" },
      ]),
    ).toBe("Silla, Cuna y Carrusel");
  });
});

describe("EVALUACIONES-04 · contrato", () => {
  const migration = source("supabase/migrations/20261020090000_evaluaciones04_pole_adaptive.sql");
  const page = source("app/admin/evaluaciones/[id]/page.tsx");
  const workspace = source("app/admin/evaluaciones/EvaluationLiveWorkspace.tsx");
  const discipline = source("app/admin/evaluaciones/disciplina/[disciplineId]/page.tsx");
  const layout = source("app/admin/evaluaciones/layout.tsx");
  const shell = source("app/admin/hoy/sendero.css");

  it("la parte personalizada vive en su tabla con RLS forzado y sólo se escribe por RPC", () => {
    expect(migration).toContain("create table public.technical_evaluation_personal_items (");
    expect(migration).toContain(
      "alter table public.technical_evaluation_personal_items force row level security;",
    );
    expect(migration).toContain(
      "revoke all on public.technical_evaluation_personal_items from anon, authenticated;",
    );
    expect(migration).not.toMatch(/grant [^;]*(insert|update|delete)[^;]*personal_items/);
    expect(migration).not.toMatch(/grant [^;]* to anon/);
    const definers = migration.match(/^security definer\nset search_path = ''$/gm) ?? [];
    const total = migration.match(/^security definer$/gm) ?? [];
    expect(total.length).toBeGreaterThanOrEqual(8);
    expect(definers.length).toBe(total.length);
  });

  it("se genera al crear cualquier evaluación y valida figuras al publicar", () => {
    expect(migration).toContain("after insert on public.technical_evaluations");
    expect(migration).toContain("after update of status on public.technical_evaluations");
    expect(migration).toContain("old.status = 'draft' and new.status = 'published'");
    for (const reason of ["pending_previous", "self_marked", "next_level"]) {
      expect(migration).toContain(`'${reason}'`);
    }
    // Nunca Profesional en la parte de siguiente nivel ni en plantillas base.
    expect(migration).toContain("v_next_catalog <> 'profesional'");
    expect(migration).toContain("and pfp.in_core_program");
  });

  it("las plantillas base no tocan plantillas existentes y se activan con la validación real", () => {
    expect(migration).toContain(
      "create or replace function public.admin_seed_pole_evaluation_templates(",
    );
    expect(migration).toContain("'template_exists'");
    expect(migration).toContain(
      "perform public.admin_activate_evaluation_template_version_v2(v_version_id);",
    );
    expect(migration).toContain("'evaluations.configure'");
    expect(discipline).toContain("Crear plantillas base");
    expect(discipline).toContain("seedPoleEvaluationTemplatesAction");
  });

  it("la evaluación en vivo separa base del nivel y parte personalizada", () => {
    expect(page).toContain("<EvaluationLiveWorkspace");
    expect(page).toContain("loadPoleEvaluationContext");
    for (const copy of [
      "Base del nivel",
      "Decide el ascenso",
      "Parte personalizada para",
      "no cambia si sube de nivel",
      "Pendientes de su evaluación anterior",
      "Por validar",
      "Lista para intentar",
      "Qué cambia en su portal al publicar",
      "Volver a armar",
    ]) {
      expect(workspace).toContain(copy);
    }
  });

  it("la evaluación usa la capa Sendero", () => {
    expect(page).toContain('<div className="sendero-evaluaciones">');
    expect(layout).toContain('import "./sendero-evaluaciones.css"');
    expect(shell).toContain(".sendero-alumnas, .sendero-evaluaciones)");
    expect(page).not.toContain('style={{ color: "#b8c1cd"');
  });
});
