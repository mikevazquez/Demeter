import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildPaymentConfirmedConditions,
  buildPaymentConfirmedVariables,
  MockMessagingProvider,
  paymentConfirmedCandidateKey,
  paymentConfirmedIdempotencyKey,
  PAYMENT_CONFIRMED_CATALOG_CODE,
} from "../supabase/functions/process-payment-confirmed/payment-confirmed";

describe("SF-176 payment confirmed", () => {
  it("maps payment variables from the immutable payment snapshot", () => {
    expect(
      buildPaymentConfirmedVariables({
        amountMinor: 60000,
        currency: "MXN",
        concept: "Paquete 8 clases",
        method: "Tarjeta",
        packageName: "Paquete 8 clases",
        balanceMinor: 20000,
      }),
    ).toEqual({
      monto: "$600.00",
      concepto: "Paquete 8 clases",
      metodo: "Tarjeta",
      paquete: "Paquete 8 clases",
      saldo_pendiente: "$200.00",
    });
  });

  it("omits pending balance when the sale is fully paid", () => {
    expect(
      buildPaymentConfirmedVariables({
        amountMinor: 100000,
        currency: "MXN",
        concept: "Ilimitado mensual",
        method: "mercado_pago",
        packageName: "Ilimitado mensual",
        balanceMinor: 0,
      }).saldo_pendiente,
    ).toBeNull();
  });

  it("rejects non-confirmed payment context during eligibility", () => {
    const conditions = buildPaymentConfirmedConditions({
      paymentKind: "refund",
      paymentAmountMinor: 30000,
      saleStatus: "confirmed",
      studentId: "student-1",
      recipient: "+523312345678",
      eventMatchesPayment: true,
      contextComplete: true,
    });

    expect(conditions).toContainEqual(
      expect.objectContaining({
        key: "payment.confirmed",
        passed: false,
        reason_code: "payment_not_confirmed",
      }),
    );
  });

  it("treats an invalid WhatsApp number as an eligibility exclusion", () => {
    const conditions = buildPaymentConfirmedConditions({
      paymentKind: "payment",
      paymentAmountMinor: 60000,
      saleStatus: "confirmed",
      studentId: "student-1",
      recipient: "331234",
      eventMatchesPayment: true,
      contextComplete: true,
    });

    expect(conditions).toContainEqual(
      expect.objectContaining({
        key: "channel.available",
        passed: false,
        reason_code: "whatsapp_contact_invalid",
      }),
    );
  });

  it("uses AUT-CAT-05 and stable payment-scoped idempotency", () => {
    expect(PAYMENT_CONFIRMED_CATALOG_CODE).toBe("AUT-CAT-05");
    expect(paymentConfirmedCandidateKey("payment-123")).toBe("payment:payment-123");
    expect(paymentConfirmedIdempotencyKey("payment-123")).toBe("sf176:payment:payment-123");
  });

  it("delivers through the mock provider without Asistian", async () => {
    const provider = new MockMessagingProvider();

    await expect(
      provider.send({
        recipient: "+523312345678",
        template: "payment_confirmed",
        variables: { monto: "$600.00" },
        executionId: "execution-1",
        metadata: { catalog_code: "AUT-CAT-05" },
      }),
    ).resolves.toMatchObject({
      status: "accepted",
      providerReference: "mock:execution-1:1",
    });
  });

  it("emits payment.confirmed only for inserted payment rows", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20260921043000_sf176_payment_confirmed.sql"),
      "utf8",
    );

    expect(migration).toContain("after insert on public.payments");
    expect(migration).toContain("when (new.kind::text = 'payment')");
    expect(migration).toContain("p_event_type => 'payment.confirmed'");
    expect(migration).toContain("'payment.confirmed:' || new.id::text");
    expect(migration).toContain("'amount_minor', new.amount_minor");
    expect(migration).toContain("'method', new.method");
    expect(migration).toContain("'concept', v_concept");
    expect(migration).toContain("'package', v_package");
    expect(migration).toContain("'balance_minor', v_balance_minor");
  });

  it("dispatches payment.confirmed asynchronously from domain_events", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20260921043000_sf176_payment_confirmed.sql"),
      "utf8",
    );

    expect(migration).toContain("after insert on public.domain_events");
    expect(migration).toContain("when (new.event_type = 'payment.confirmed')");
    expect(migration).toContain("private.dispatch_payment_confirmed_event_id(new.event_id)");
    expect(migration).toContain("/functions/v1/process-payment-confirmed");
    expect(migration).toContain("net.http_post(");
  });

  it("uses custom Vault-backed internal authentication", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20260921043000_sf176_payment_confirmed.sql"),
      "utf8",
    );
    const source = readFileSync(
      join(process.cwd(), "supabase/functions/process-payment-confirmed/index.ts"),
      "utf8",
    );
    const config = readFileSync(join(process.cwd(), "supabase/config.toml"), "utf8");

    expect(migration).toContain("studio_flow_automation_dispatch_token");
    expect(source).toContain('withSupabase({ auth: "none" }');
    expect(source).toContain('request.headers.get("x-studio-flow-dispatch-token")');
    expect(source).toContain('"verify_automation_dispatch_token"');
    expect(config).toContain("[functions.process-payment-confirmed]\nverify_jwt = false");
  });

  it("preserves the SF-165/SF-166 pipeline and combination metadata", () => {
    const source = readFileSync(
      join(process.cwd(), "supabase/functions/process-payment-confirmed/index.ts"),
      "utf8",
    );

    expect(source).toContain("record_automation_eligibility_evaluation");
    expect(source).toContain("system_create_automation_execution");
    expect(source).toContain("system_start_automation_execution_attempt");
    expect(source).toContain("system_mark_automation_execution_accepted");
    expect(source).toContain('combination_candidate: "AUT-CAT-06"');
    expect(source).toContain("communication_group_key");
    expect(source).toContain("MockMessagingProvider");
  });
});
