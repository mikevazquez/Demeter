import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assignRequiredAction,
  createRequiredAction,
  discardRequiredAction,
  resolveRequiredAction,
  systemAutoCloseRequiredAction,
  takeRequiredAction,
  type RequiredActionRpcClient,
  type RequiredActionRpcResult,
} from "../lib/automations/required-actions";

class FakeRequiredActionRpcClient implements RequiredActionRpcClient {
  readonly calls: Array<{
    functionName: string;
    args: Record<string, unknown>;
  }> = [];

  async rpc<T>(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<RequiredActionRpcResult<T>> {
    this.calls.push({ functionName, args });

    if (functionName === "admin_create_required_action") {
      return { data: "action-1" as unknown as T, error: null };
    }

    if (functionName === "system_auto_close_required_action") {
      return { data: "action-1" as unknown as T, error: null };
    }

    return { data: null, error: null };
  }
}

const input = {
  studioId: "11111111-1111-1111-1111-111111111111",
  incidentKey: "walkin:22222222-2222-2222-2222-222222222222:unpaid",
  priority: "high" as const,
  sourceEventId: "33333333-3333-3333-3333-333333333333",
  reason: "Walk-in pendiente de pago",
  studentId: "44444444-4444-4444-4444-444444444444",
  classSessionId: "55555555-5555-5555-5555-555555555555",
};

describe("SF-161 required actions", () => {
  it("maps creation to the protected admin RPC", async () => {
    const client = new FakeRequiredActionRpcClient();

    await expect(createRequiredAction(client, input)).resolves.toBe("action-1");
    expect(client.calls[0]).toEqual({
      functionName: "admin_create_required_action",
      args: {
        p_studio_id: input.studioId,
        p_incident_key: input.incidentKey,
        p_priority: input.priority,
        p_source_event_id: input.sourceEventId,
        p_reason: input.reason,
        p_student_id: input.studentId,
        p_class_session_id: input.classSessionId,
        p_assignee_user_id: null,
      },
    });
  });

  it("maps assign, take, resolve and discard without bypassing the service", async () => {
    const client = new FakeRequiredActionRpcClient();

    await assignRequiredAction(client, "action-1", "user-1");
    await takeRequiredAction(client, "action-1");
    await resolveRequiredAction(client, "action-1", "Cobro confirmado");
    await discardRequiredAction(client, "action-2", "Incidencia inválida");

    expect(client.calls.map((call) => call.functionName)).toEqual([
      "admin_assign_required_action",
      "admin_take_required_action",
      "admin_resolve_required_action",
      "admin_discard_required_action",
    ]);
  });

  it("requires a discard reason before calling the backend", async () => {
    const client = new FakeRequiredActionRpcClient();

    await expect(discardRequiredAction(client, "action-1", " ")).rejects.toThrow(
      "required_action_discard_reason_required",
    );
    expect(client.calls).toHaveLength(0);
  });

  it("supports traceable automatic closure by incident key", async () => {
    const client = new FakeRequiredActionRpcClient();

    await expect(
      systemAutoCloseRequiredAction(
        client,
        input.studioId,
        input.incidentKey,
        "La causa se resolvió por otra vía",
      ),
    ).resolves.toBe("action-1");

    expect(client.calls[0]?.functionName).toBe("system_auto_close_required_action");
  });

  it("locks the SQL contract to approved states, dedupe, audit and capabilities", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20260918210335_sf161_required_actions.sql"),
      "utf8",
    );
    const hardening = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260918210356_sf161_required_actions_index_hardening.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("'pending'");
    expect(migration).toContain("'in_progress'");
    expect(migration).toContain("'resolved'");
    expect(migration).toContain("'discarded'");
    expect(migration).toContain("'high'");
    expect(migration).toContain("'medium'");
    expect(migration).toContain("'low'");
    expect(migration).toContain("required_actions_open_incident_unique");
    expect(migration).toContain("where status in ('pending', 'in_progress')");
    expect(migration).toContain("required_action_discard_reason_required");
    expect(migration).toContain("required_action_audit_immutable");
    expect(migration).toContain("required_actions.read");
    expect(migration).toContain("required_actions.manage");
    expect(migration).toContain("required_actions_source_event_tenant_fkey");
    expect(migration).toContain("system_auto_close_required_action");
    expect(hardening).toContain("required_actions_assignee_user_idx");
    expect(hardening).toContain("required_actions_created_by_user_idx");
  });
});
