import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("DEMI-PROS-03A prospect buys a package by transfer (D-PAY-01)", () => {
  const migration = source(
    "supabase/migrations/20261021210000_demi_prospect_transfer_purchase.sql",
  );
  const actions = source("lib/assistant/action-tools.ts");
  const contracts = source("lib/assistant/tool-contracts.ts");
  const orchestrator = source("lib/assistant/orchestrator.ts");
  const webhook = source("app/api/integrations/meta-whatsapp/webhook/route.ts");

  const prepareStart =
    "create or replace function public.service_prepare_prospect_transfer_purchase";
  const recordStart = "create or replace function public.service_record_prospect_transfer_receipt";
  const completeStart =
    "create or replace function public.service_complete_prospect_transfer_purchase";
  const prepare = migration.slice(migration.indexOf(prepareStart), migration.indexOf(recordStart));

  it("records only the pending purchase before payment", () => {
    expect(prepare).toContain("student_id,crm_contact_id");
    expect(prepare).toContain("p_studio,p_conversation,null,p_contact");
    expect(prepare).not.toContain("assistant_ensure_trial_student");
    expect(prepare).not.toContain("update public.persons");
    expect(prepare).not.toContain("insert into public.students");
  });

  it("charges enrollment unless the product includes it", () => {
    expect(migration).toContain("if not coalesce(v_product.enrollment_included,false) then");
    expect(migration).toContain("v_product.price_minor+v_enrollment_product.price_minor");
  });

  it("waits for the profile after a matching receipt", () => {
    expect(migration).toContain("set status='awaiting_profile'");
    expect(webhook).toContain("service_record_prospect_transfer_receipt");
    expect(webhook).toContain("tu nombre completo, tu fecha de nacimiento y tu correo electrónico");
  });

  it("registers the profile, creates the student and activates in one transaction", () => {
    const complete = migration.slice(migration.indexOf(completeStart));
    expect(complete).toContain("status='awaiting_profile'");
    expect(complete).toContain("public.assistant_ensure_trial_student(p_studio,p_contact)");
    expect(complete).toContain("key='birth_date'");
    expect(complete).toContain("public.service_activate_transfer_receipt(");
    expect(complete).toContain("raise exception 'transfer_activation_failed");
    expect(complete).toContain("lifecycle_status='student'");
    expect(complete).toContain("'email_in_use'");
  });

  it("exposes the purchase to prospects without the first-class fallback", () => {
    expect(contracts).toContain('name: "complete_purchase_profile"');
    expect(actions).toContain("service_prepare_prospect_transfer_purchase");
    expect(actions).toContain("service_complete_prospect_transfer_purchase");
    expect(orchestrator).toContain(
      'if (tool.name === "prepare_bank_transfer_purchase") return Boolean(input.crmContactId);',
    );
    expect(orchestrator).toContain("nunca lo cambies por clase suelta");
  });

  it("keeps all new service functions away from clients", () => {
    for (const fn of [
      "service_preview_prospect_transfer_purchase(uuid,uuid,uuid,uuid)",
      "service_prepare_prospect_transfer_purchase(uuid,uuid,uuid,uuid,uuid)",
      "service_record_prospect_transfer_receipt(uuid,uuid,uuid,uuid,uuid,text,text)",
      "service_complete_prospect_transfer_purchase(uuid,uuid,uuid,text,date,text)",
    ]) {
      expect(migration).toContain(
        `revoke all on function public.${fn} from public,anon,authenticated;`,
      );
      expect(migration).toContain(`grant execute on function public.${fn} to service_role;`);
    }
  });
});
