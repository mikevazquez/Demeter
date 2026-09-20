import { describe, expect, it } from "vitest";

import {
  AUTOMATION_CATALOG,
  AUTOMATION_CATALOG_VERSION,
  AUTOMATION_DOMINANCE_RULES,
  AUTOMATION_SEQUENCES,
  getAutomationTemplate,
  getAutomationTemplatesByCategory,
} from "../lib/automations/catalog";

describe("SF-163 automation catalog", () => {
  it("locks the active catalog after retiring incident automations", () => {
    expect(AUTOMATION_CATALOG_VERSION).toBe(1);
    expect(AUTOMATION_CATALOG).toHaveLength(13);

    const codes = AUTOMATION_CATALOG.map((entry) => entry.code);
    const keys = AUTOMATION_CATALOG.map((entry) => entry.key);

    expect(new Set(codes).size).toBe(13);
    expect(new Set(keys).size).toBe(13);
    expect(codes).toEqual([
      "AUT-CAT-01",
      "AUT-CAT-02",
      "AUT-CAT-03",
      "AUT-CAT-04",
      "AUT-CAT-05",
      "AUT-CAT-06",
      "AUT-CAT-07",
      "AUT-CAT-11",
      "AUT-CAT-12",
      "AUT-CAT-13",
      "AUT-CAT-14",
      "AUT-CAT-15",
      "AUT-CAT-16",
    ]);
  });

  it("preserves the active category split", () => {
    expect(getAutomationTemplatesByCategory("operation")).toHaveLength(6);
    expect(getAutomationTemplatesByCategory("team")).toHaveLength(1);
    expect(getAutomationTemplatesByCategory("administration")).toHaveLength(0);
    expect(getAutomationTemplatesByCategory("conversion")).toHaveLength(2);
    expect(getAutomationTemplatesByCategory("retention")).toHaveLength(4);
  });

  it("keeps the visible operational contracts and instance modes", () => {
    for (const code of ["AUT-CAT-01", "AUT-CAT-02", "AUT-CAT-03", "AUT-CAT-05"] as const) {
      const template = getAutomationTemplate(code);
      expect(template.priority.communication).toBe("P1");
      expect(template.recipients).toContain("student");
      expect(template.configurationMode).toBe("single");
    }

    const reminder = getAutomationTemplate("AUT-CAT-04");
    expect(reminder.priority.communication).toBe("P1");
    expect(reminder.configurationMode).toBe("multiple");
    expect(reminder.configurableParameters).toContain("lead_time");

    const packageActivated = getAutomationTemplate("AUT-CAT-06");
    expect(packageActivated.priority.communication).toBe("P1");
    expect(packageActivated.variables).toContain("fecha_vencimiento");

    const coachSummary = getAutomationTemplate("AUT-CAT-07");
    expect(coachSummary.priority.communication).toBeNull();
    expect(coachSummary.priority.scope).toBe("internal");
  });

  it("preserves conversion and retention priority policies", () => {
    expect(getAutomationTemplate("AUT-CAT-11").priority.communication).toBe("P2");

    const noPurchase = getAutomationTemplate("AUT-CAT-12");
    expect(noPurchase.priority.communication).toBe("P2");
    expect(noPurchase.priority.promotionalOverride).toBe("P3");

    const expiring = getAutomationTemplate("AUT-CAT-13");
    expect(expiring.priority.communication).toBe("P2");
    expect(expiring.configurationMode).toBe("multiple");
    expect(expiring.protectedConditions).toContain("Paquete activo.");

    expect(getAutomationTemplate("AUT-CAT-14").priority.communication).toBe("P2");
    expect(getAutomationTemplate("AUT-CAT-15").priority.communication).toBe("P2");

    const recovery = getAutomationTemplate("AUT-CAT-16");
    expect(recovery.priority.communication).toBe("P3");
    expect(recovery.requirements).toContain("active_recovery_promotion");
  });

  it("locks the three approved predefined sequences without creating a free journey builder", () => {
    expect(AUTOMATION_SEQUENCES.map((sequence) => sequence.code)).toEqual([
      "SEC-01",
      "SEC-02",
      "SEC-03",
    ]);

    expect(AUTOMATION_SEQUENCES[0].memberCodes).toEqual(["AUT-CAT-11", "AUT-CAT-12"]);
    expect(AUTOMATION_SEQUENCES[1].memberCodes).toEqual(["AUT-CAT-13", "AUT-CAT-15", "AUT-CAT-16"]);
    expect(AUTOMATION_SEQUENCES[2].memberCodes).toEqual(["AUT-CAT-14"]);
  });

  it("preserves the active dominance and suppression rules", () => {
    expect(AUTOMATION_DOMINANCE_RULES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: { kind: "automation", code: "AUT-CAT-13" },
          target: { kind: "automation", code: "AUT-CAT-14" },
          effect: "dominates",
        }),
        expect.objectContaining({
          source: { kind: "context", key: "future_reservation" },
          target: { kind: "automation", code: "AUT-CAT-14" },
          effect: "suppresses",
        }),
      ]),
    );
  });

  it("keeps protected logic separate from safe configuration", () => {
    for (const template of AUTOMATION_CATALOG) {
      expect(template.protectedConditions).toBeDefined();
      expect(template.configurableParameters).toBeDefined();
      expect(template.trigger.description.trim().length).toBeGreaterThan(0);
      expect(template.frequency.description.trim().length).toBeGreaterThan(0);
      expect(template.recipients.length).toBeGreaterThan(0);
    }

    const expiring = getAutomationTemplate("AUT-CAT-13");
    expect(expiring.configurableParameters).toContain("days_before_expiration");
    expect(expiring.configurableParameters).toContain("allowed_frequency");
    expect(expiring.protectedConditions).toContain(
      "Sin renovación que vuelva irrelevante el mensaje.",
    );
  });
});
