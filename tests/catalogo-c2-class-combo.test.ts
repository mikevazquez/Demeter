import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Catálogo C2 · combo operativo durante clase Pole", () => {
  const today = source("app/admin/hoy/TodayClasses.tsx");
  const panel = source("app/admin/agenda/[sessionId]/PoleClassComboPanel.tsx");
  const client = source("app/admin/agenda/[sessionId]/PoleClassComboClient.tsx");
  const action = source("app/admin/agenda/[sessionId]/pole-actions.ts");
  const styles = source("app/admin/agenda/[sessionId]/pole-class-combo.module.css");

  it("shows Pole combo tools only while the class is live", () => {
    expect(today).toContain('phase === "live"');
    expect(today).toContain("poleFlows.find");
    expect(today).not.toContain('phase === "upcoming" ? (poleFlows');
    expect(today).not.toContain('phase === "finished" ? (poleFlows');
  });

  it("groups enrolled students by their actual technical level", () => {
    expect(panel).toContain('.from("student_discipline_levels")');
    expect(panel).toContain("toCatalogLevel");
    expect(panel).toContain("grouped");
    expect(panel).toContain("Principiante");
    expect(panel).toContain("Intermedio");
    expect(panel).toContain("Avanzado");
  });

  it("builds one combo per level from figures all members already know plus one new figure", () => {
    expect(panel).toContain("prerrequisitos_sugeridos");
    expect(panel).toContain("allKnow");
    expect(panel).toContain("nobodyKnows");
    expect(panel).toContain("sameType");
    expect(panel).not.toContain("groupLevelOrder");
    expect(panel).not.toContain("catalog.combos_base");
  });

  it("uses the HTML only as behavior reference, not as a guided walkthrough", () => {
    expect(client).toContain("Generar combos");
    expect(client).toContain("Registrar resultados");
    expect(client).toContain("Otra opción");
    expect(client).toContain("La logró");
    expect(client).not.toContain("Abrir la clase");
    expect(client).not.toContain("PASO 1 DE 3");
    expect(client).not.toContain("Combos por nivel");
  });

  it("persists only validated new figures against the actual class session", () => {
    expect(action).toContain("savePoleClassResultsAction");
    expect(action).toContain("set_student_pole_figure_achievement");
    expect(action).toContain("p_class_session_id: normalizedSessionId");
    expect(action).toContain("CAPABILITIES.EVALUATIONS_WRITE");
  });

  it("keeps Professional outside automatic combos but supports individual instructor authorization", () => {
    expect(panel).toContain('figure.nivel !== "Profesional"');
    expect(panel).toContain("professionalSuggestionSlugs");
    expect(client).toContain("Autorizaciones individuales");
    expect(action).toContain("setProfessionalPoleAuthorizationAction");
    expect(action).toContain('"student_pole_authorizations"');
  });

  it("uses compact Sendero controls for the live class utility", () => {
    expect(styles).toContain("#8fe6c8");
    expect(styles).toContain('"Sendero Marcellus"');
    expect(styles).toContain(".toolbar");
    expect(styles).toContain(".readyState");
    expect(styles).toContain("@media (max-width: 760px)");
    expect(styles).not.toContain(".stepper");
  });
});
