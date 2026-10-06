import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Demi identity, CRM lifecycle, and first trial flow", () => {
  const orchestrator = readFileSync(join(process.cwd(), "lib/assistant/orchestrator.ts"), "utf8");
  const route = readFileSync(join(process.cwd(), "app/api/integrations/meta-whatsapp/webhook/route.ts"), "utf8");
  const actionTools = readFileSync(join(process.cwd(), "lib/assistant/action-tools.ts"), "utf8");
  const readTools = readFileSync(join(process.cwd(), "lib/assistant/read-tools.ts"), "utf8");
  const directory = readFileSync(join(process.cwd(), "app/admin/alumnas/page.tsx"), "utf8");
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20261006220000_demi_first_trial_name_capture.sql"),
    "utf8",
  );

  it("answers prospect questions and requires a saved name only before booking", () => {
    expect(orchestrator).toContain("puedes responder su pregunta actual usando las herramientas oficiales");
    expect(orchestrator).toContain("no prepares una reserva de prueba hasta que Studio Flow confirme");
    expect(orchestrator).not.toContain("if (input.identityNeedsName === true) {");
    expect(route).toContain("const identityNeedsName = prepared.identity_needs_name === true;");
    expect(actionTools).toContain('ctx.identityNeedsName === true && !ctx.studentId');
    expect(actionTools).toContain('reason_code: "prospect_name_required"');
    expect(orchestrator).toContain("reason_code=prospect_name_required");
  });

  it("uses phone identity and asks Studio Flow for the person's current lifecycle", () => {
    expect(orchestrator).toContain("número de teléfono normalizado es el identificador único");
    expect(orchestrator).toContain("get_student_package_status");
    expect(readTools).toContain("student_type,trial_status");
    expect(readTools).toContain('"trial_no_show"');
    expect(readTools).toContain('"former_student"');
    expect(migration).toContain("v_student_matches = 1");
    expect(migration).not.toContain("v_student_name_matches");
    expect(migration).toContain("public.person_contacts pc");
    expect(migration).toContain("insert into public.person_contacts");
  });

  it("restores the CRM filters for prospects, trial students, and no-shows", () => {
    expect(directory).toContain('.eq("lifecycle_status", "prospect")');
    expect(directory).toContain('.eq("student_type", "trial")');
    expect(directory).toContain('.eq("trial_status", "no_show")');
    expect(directory).toContain('{ key: "trial", label: "Alumnas de prueba", enabled: true }');
    expect(directory).toContain('{ key: "no_show", label: "No show", enabled: true }');
    expect(directory).toContain('{ key: "prospect", label: "Prospectos", enabled: true }');
    expect(directory).toContain('{ key: "expired", label: "Exalumnas", enabled: canReadProducts }');
  });

  it("keeps the first-trial price in Studio Flow and stores the prospect's name", () => {
    expect(migration).toContain("update public.persons p");
    expect(migration).toContain("on conflict (studio_id) do nothing");
    expect(migration.match(/'amount_minor',15000/g)).toHaveLength(2);
    expect(migration).toContain("'payment_pending'");
  });
});
