import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import * as personas from "../lib/assistant/prompt-workbench";
import type { TestSimulation } from "../lib/assistant/test-simulation";

function simulationModule() {
  const code = transformSync(
    readFileSync("lib/assistant/test-simulation.ts", "utf8").replace('import "server-only";', ""),
    { loader: "ts", format: "cjs" },
  ).code;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", code)(
    (name: string) => {
      if (name === "./prompt-workbench") return personas;
      if (name === "./action-tools") return { isExplicitAssistantConfirmation: () => false };
      throw new Error(`Unexpected external dependency: ${name}`);
    },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports as typeof import("../lib/assistant/test-simulation");
}

const packId = "11111111-1111-4111-8111-111111111111";
const passId = "22222222-2222-4222-8222-222222222222";
const enrollmentId = "33333333-3333-4333-8333-333333333333";
const studioId = "sandbox-fixture";

function harness(
  workbenchCase: personas.WorkbenchCase = "S12",
  persona: personas.TestPersona = "prospect",
) {
  const sim = simulationModule();
  const state = sim.createTestSimulation(persona, workbenchCase);
  const rows: Record<string, Array<Record<string, unknown>>> = {
    product_templates: [
      {
        id: packId,
        studio_id: studioId,
        active: true,
        assistant_visible: null,
        product_type: "package",
        name: "8 clases",
        price_minor: 60000,
        currency: "MXN",
        credit_limit: 8,
        unlimited: false,
        enrollment_included: false,
      },
      {
        id: passId,
        studio_id: studioId,
        active: true,
        assistant_visible: true,
        product_type: "package",
        name: "Pase Descubre",
        price_minor: 49900,
        currency: "MXN",
        credit_limit: 3,
        unlimited: false,
        enrollment_included: true,
      },
      {
        id: enrollmentId,
        studio_id: studioId,
        active: true,
        product_type: "enrollment",
        name: "Inscripción",
        price_minor: 20000,
        currency: "MXN",
      },
    ],
    enrollment_policies: [
      {
        studio_id: studioId,
        enabled: true,
        required_for_package_purchase: true,
        enrollment_product_template_id: enrollmentId,
      },
    ],
  };
  const reads: { table: string; studio: string | null }[] = [];
  const forbidden = vi.fn(() => {
    throw new Error("Business writes/RPCs are forbidden");
  });
  const supabase = {
    rpc: forbidden,
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const read = { table, studio: null as string | null };
      reads.push(read);
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          if (key === "studio_id") read.studio = String(value);
          filters.push((row) => row[key] === value);
          return query;
        },
        neq: (key: string, value: unknown) => {
          filters.push((row) => row[key] !== value);
          return query;
        },
        or: () => {
          filters.push((row) => row.assistant_visible !== false);
          return query;
        },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({
          data: rows[table]?.find((row) => filters.every((predicate) => predicate(row))) ?? null,
          error: null,
        }),
        insert: forbidden,
        update: forbidden,
        delete: forbidden,
        upsert: forbidden,
      };
      return query;
    },
  };
  const input = {
    state,
    supabase,
    studio: { id: studioId, timezone: "America/Mexico_City", currency: "MXN" },
    turnId: "turn-1",
    currentUserMessage: "Quiero el paquete por transferencia.",
  } as unknown as Parameters<typeof sim.simulateAssistantAction>[0];
  const prepare = (productId = packId, accepted = false) =>
    sim.simulateAssistantAction(input, "prepare_bank_transfer_purchase", {
      product_ref: `product:${productId}`,
      session_ref: null,
      enrollment_accepted: accepted,
    });
  return { sim, state, rows, reads, forbidden, input, prepare };
}

describe("Sandbox workbench purchase fixtures", () => {
  it("keeps the standard benchmark simulation unchanged", async () => {
    const h = harness("standard");
    expect(await h.prepare()).toMatchObject({ ok: false, error: "simulation_not_supported" });
    expect(h.sim.simulatedReadTool(h.state, "get_student_package_status")).not.toHaveProperty(
      "workbench_context",
    );
    expect(h.reads).toEqual([]);
  });

  it("charges only the included-enrollment Pase and never creates a profile before receipt", async () => {
    const h = harness("S11");
    expect(await h.prepare(passId)).toMatchObject({
      ok: true,
      total_amount_minor: 49900,
      enrollment_required: false,
      status: "awaiting_receipt",
    });
    expect(h.state.persona).toBe("prospect");
    expect(h.state.credits).toBe(0);
    expect(h.state.identityNeedsName).toBe(true);
    expect(h.sim.confirmSimulatedProspectName(h.state, "Soy Ana Prueba")).toBe(false);
    expect(h.forbidden).not.toHaveBeenCalled();
    expect(h.reads.every((read) => read.studio === studioId)).toBe(true);
  });

  it("previews the full total without a purchase and waits for a later accepted turn", async () => {
    const h = harness();
    expect(await h.prepare()).toMatchObject({
      reason_code: "enrollment_confirmation_required",
      total_amount_minor: 80000,
      enrollment: { amount_minor: 20000 },
      package: { amount_minor: 60000 },
    });
    expect(h.state.transfer).toBeUndefined();
    expect(await h.prepare(packId, true)).toMatchObject({
      reason_code: "enrollment_confirmation_required",
    });
    h.input.turnId = "turn-2";
    h.input.currentUserMessage = "No, todavía no acepto.";
    expect(await h.prepare()).toMatchObject({ reason_code: "enrollment_confirmation_required" });
    expect(h.state.transfer).toBeUndefined();
    h.input.turnId = "turn-3";
    h.input.currentUserMessage = "Sí, acepto la inscripción y el paquete.";
    expect(await h.prepare(packId, true)).toMatchObject({
      ok: true,
      total_amount_minor: 80000,
      status: "awaiting_receipt",
    });
    expect(h.state.credits).toBe(0);
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("does not accept a text payment claim as receipt evidence", async () => {
    const h = harness("S11");
    await h.prepare(passId);
    h.input.currentUserMessage = "Ya pagué y mandé el comprobante.";
    expect(
      await h.sim.simulateAssistantAction(h.input, "complete_purchase_profile", {
        full_name: "Ana Prueba",
        birth_date: "1995-05-10",
        email: "ana@example.test",
      }),
    ).toMatchObject({ reason_code: "payment_not_confirmed" });
    expect(h.state.transfer?.status).toBe("awaiting_receipt");
    expect(h.state.transfer?.receiptEvidence).toBeUndefined();
  });

  it("waits for a complete valid profile after the explicit receipt event, with idempotent activation", async () => {
    const h = harness("S11");
    await h.prepare(passId);
    expect(h.sim.recordSimulatedTransferReceipt(h.state)).toBe(true);
    expect(h.state.transfer).toMatchObject({
      status: "awaiting_profile",
      receiptEvidence: "admin_fixture_event",
    });
    expect(h.state.persona).toBe("prospect");
    const profile = {
      full_name: "Ana Prueba",
      birth_date: "1995-05-10",
      email: "ana@example.test",
    };
    for (const [args, reason] of [
      [{ ...profile, full_name: "Ana" }, "full_name_required"],
      [{ ...profile, birth_date: "1995-02-30" }, "birth_date_invalid"],
      [{ ...profile, birth_date: "2995-01-01" }, "birth_date_invalid"],
      [{ ...profile, email: "no-es-correo" }, "email_invalid"],
    ] as const) {
      expect(
        await h.sim.simulateAssistantAction(h.input, "complete_purchase_profile", args),
      ).toMatchObject({ ok: false, reason_code: reason });
      expect(h.state.persona).toBe("prospect");
      expect(h.state.credits).toBe(0);
    }
    expect(
      await h.sim.simulateAssistantAction(h.input, "complete_purchase_profile", profile),
    ).toMatchObject({
      status: "provisional_active",
      enrollment_included: true,
      revocable_until_validated: true,
    });
    expect(h.state.persona).toBe("student");
    expect(h.state.credits).toBe(3);
    expect(
      await h.sim.simulateAssistantAction(h.input, "complete_purchase_profile", profile),
    ).toMatchObject({ idempotent: true });
    expect(h.state.credits).toBe(3);
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("uses the same enrollment quote for a student, and no enrollment charge if already active", async () => {
    const h = harness("S14", "student");
    expect(h.sim.simulatedReadTool(h.state, "get_student_package_status")).toMatchObject({
      student_state: { enrollment_status: "missing" },
      current_package: null,
    });
    expect(await h.prepare()).toMatchObject({
      total_amount_minor: 80000,
      reason_code: "enrollment_confirmation_required",
    });
    h.state.enrollmentStatus = "active";
    expect(await h.prepare()).toMatchObject({
      ok: true,
      total_amount_minor: 60000,
      enrollment_required: false,
    });
    expect(h.sim.recordSimulatedTransferReceipt(h.state)).toBe(true);
    expect(h.state.transfer?.status).toBe("provisional_active");
    expect(h.state.credits).toBe(8);
    expect(h.sim.simulatedReadTool(h.state, "get_student_package_status")).toMatchObject({
      current_package: { available_credits: 8 },
    });
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("asks again if the official price changed since confirmation preview", async () => {
    const h = harness();
    await h.prepare();
    h.rows.product_templates[0].price_minor = 65000;
    h.input.turnId = "turn-2";
    expect(await h.prepare(packId, true)).toMatchObject({
      total_amount_minor: 85000,
      reason_code: "enrollment_confirmation_required",
    });
    expect(h.state.transfer).toBeUndefined();
  });

  it("does not quote a hidden or cross-studio product", async () => {
    const h = harness();
    h.rows.product_templates[0].studio_id = "different-studio";
    expect(await h.prepare()).toMatchObject({ reason_code: "purchase_quote_unavailable" });
    h.rows.product_templates[0].studio_id = studioId;
    h.rows.product_templates[0].assistant_visible = false;
    expect(await h.prepare()).toMatchObject({ reason_code: "purchase_quote_unavailable" });
    expect(h.state.transfer).toBeUndefined();
  });

  it("seeds receipt/profile only in S13, using studio-scoped catalogue reads", async () => {
    const h = harness("S13");
    expect(await h.sim.initializeTestScenario(h.input.supabase, studioId, h.state)).toBe(true);
    expect(h.state.transfer).toMatchObject({
      status: "awaiting_profile",
      receiptEvidence: "seeded_fixture",
    });
    expect(h.sim.simulatedReadTool(h.state, "get_student_package_status")).toMatchObject({
      workbench_context: { purchase_status: "awaiting_profile" },
    });
    expect(h.reads.every((read) => read.studio === studioId)).toBe(true);
    const state: TestSimulation = h.sim.createTestSimulation("prospect", "S13");
    expect(await h.sim.initializeTestScenario(h.input.supabase, "other-studio", state)).toBe(false);
    expect(state.transfer).toBeUndefined();
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("represents closed pending and active rights without inventing a payment to collect", () => {
    const h = harness("S15", "student");
    expect(h.sim.simulatedReadTool(h.state, "get_student_package_status")).toMatchObject({
      student_state: { enrollment_status: "active" },
      workbench_context: { closed_first_class: true, purchase_status: null },
      current_package: { available_credits: 8 },
    });
    expect(h.sim.recordSimulatedTransferReceipt(h.state)).toBe(false);
    expect(h.forbidden).not.toHaveBeenCalled();
  });
});
