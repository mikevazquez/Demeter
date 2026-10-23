import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Catálogo C2 · flujo de clase Pole por nivel", () => {
  const detail = source("app/admin/agenda/[sessionId]/page.tsx");
  const panel = source("app/admin/agenda/[sessionId]/PoleClassComboPanel.tsx");
  const client = source("app/admin/agenda/[sessionId]/PoleClassComboClient.tsx");
  const action = source("app/admin/agenda/[sessionId]/pole-actions.ts");
  const styles = source("app/admin/agenda/[sessionId]/pole-class-combo.module.css");

  it("mounts the Pole workflow in class detail", () => {
    expect(detail).toContain("<PoleClassComboPanel");
    expect(detail).toContain("template?.discipline_id");
    expect(detail).toContain("CAPABILITIES.EVALUATIONS_WRITE");
  });

  it("groups scheduled students by their actual technical level", () => {
    expect(panel).toContain('.from("student_discipline_levels")');
    expect(panel).toContain("toCatalogLevel");
    expect(panel).toContain("grouped");
    expect(panel).toContain("Principiante");
    expect(panel).toContain("Intermedio");
    expect(panel).toContain("Avanzado");
  });

  it("builds each combo from prerequisites and figures every member already knows", () => {
    expect(panel).toContain("prerrequisitos_sugeridos");
    expect(panel).toContain("allKnow");
    expect(panel).toContain("nobodyKnows");
    expect(panel).toContain("sameType");
    expect(panel).not.toContain("groupLevelOrder");
    expect(panel).not.toContain("catalog.combos_base");
  });

  it("never includes Professional in automatic class generation", () => {
    expect(panel).toContain('figure.nivel !== "Profesional"');
    expect(panel).not.toContain("Profesional:");
  });

  it("matches the prototype flow: open class, combos by level, validate at the end", () => {
    expect(client).toContain("Abrir la clase");
    expect(client).toContain("Combos por nivel");
    expect(client).toContain("Validar al final");
    expect(client).toContain("Otra opción");
    expect(client).toContain("La logró");
    expect(client).toContain("Guardar progreso");
  });

  it("persists only validated new figures against the actual class session", () => {
    expect(action).toContain("savePoleClassResultsAction");
    expect(action).toContain("set_student_pole_figure_achievement");
    expect(action).toContain("p_class_session_id: normalizedSessionId");
    expect(action).toContain("CAPABILITIES.EVALUATIONS_WRITE");
  });

  it("keeps Professional outside combos but lets instructors authorize and validate it", () => {
    expect(panel).toContain("professionalSuggestionSlugs");
    expect(client).toContain("Autorizar figuras Profesional");
    expect(client).toContain("La logró");
    expect(action).toContain("setProfessionalPoleAuthorizationAction");
    expect(action).toContain('"student_pole_authorizations"');
    expect(action).toContain("pole_professional_authorization_advanced_only");
  });

  it("uses Sendero for the guided flow", () => {
    expect(styles).toContain("#8fe6c8");
    expect(styles).toContain('"Sendero Marcellus"');
    expect(styles).toContain(".stepper");
    expect(styles).toContain("@media (max-width: 760px)");
  });
});
