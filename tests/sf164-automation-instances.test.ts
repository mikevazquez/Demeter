import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  activateAutomationInstance,
  archiveAutomationInstance,
  assertAutomationConfiguration,
  createAutomationInstance,
  deleteAutomationDraft,
  markAutomationInstanceExecuted,
  pauseAutomationInstance,
  setAutomationInstanceError,
  updateAutomationInstanceConfiguration,
  type AutomationInstanceRpcClient,
  type AutomationInstanceRpcResult,
} from "../lib/automations/instances";

class FakeAutomationInstanceRpcClient implements AutomationInstanceRpcClient {
  readonly calls: Array<{
    functionName: string;
    args: Record<string, unknown>;
  }> = [];

  async rpc<T>(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<AutomationInstanceRpcResult<T>> {
    this.calls.push({ functionName, args });

    if (
      functionName === "admin_create_automation_instance" ||
      functionName === "system_create_automation_instance"
    ) {
      return { data: "instance-1" as unknown as T, error: null };
    }

    if (functionName === "admin_update_automation_instance_configuration") {
      return { data: 2 as unknown as T, error: null };
    }

    return { data: null, error: null };
  }
}

describe("SF-164 automation instances", () => {
  it("maps approved configuration to the protected admin RPC", async () => {
    const client = new FakeAutomationInstanceRpcClient();

    await expect(
      createAutomationInstance(client, {
        studioId: "11111111-1111-1111-1111-111111111111",
        catalogCode: "AUT-CAT-13",
        configuration: {
          days_before_expiration: 5,
          message_template: "paquete_por_vencer_v1",
        },
      }),
    ).resolves.toBe("instance-1");

    expect(client.calls[0]).toEqual({
      functionName: "admin_create_automation_instance",
      args: {
        p_studio_id: "11111111-1111-1111-1111-111111111111",
        p_catalog_code: "AUT-CAT-13",
        p_configuration: {
          days_before_expiration: 5,
          message_template: "paquete_por_vencer_v1",
        },
      },
    });
  });

  it("rejects parameters that are not configurable in the SF-163 catalog", () => {
    expect(() =>
      assertAutomationConfiguration("AUT-CAT-13", {
        protected_priority: "P0",
      }),
    ).toThrow("automation_configuration_key_not_allowed:protected_priority");
  });


  it("creates a new immutable version when configuration changes", async () => {
    const client = new FakeAutomationInstanceRpcClient();

    await expect(
      updateAutomationInstanceConfiguration(client, {
        instanceId: "instance-1",
        catalogCode: "AUT-CAT-13",
        configuration: { days_before_expiration: 3 },
      }),
    ).resolves.toBe(2);

    expect(client.calls[0]?.functionName).toBe("admin_update_automation_instance_configuration");
  });

  it("maps lifecycle operations without bypassing the domain RPCs", async () => {
    const client = new FakeAutomationInstanceRpcClient();

    await activateAutomationInstance(client, "instance-1");
    await pauseAutomationInstance(client, "instance-1");
    await activateAutomationInstance(client, "instance-1");
    await archiveAutomationInstance(client, "instance-1");
    await deleteAutomationDraft(client, "draft-1");

    expect(client.calls.map((call) => call.functionName)).toEqual([
      "admin_activate_automation_instance",
      "admin_pause_automation_instance",
      "admin_activate_automation_instance",
      "admin_archive_automation_instance",
      "admin_delete_automation_draft",
    ]);
  });

  it("prepares the execution bridge without implementing SF-166 execution history", async () => {
    const client = new FakeAutomationInstanceRpcClient();

    await setAutomationInstanceError(client, {
      instanceId: "instance-1",
      errorCode: "template_unavailable",
      errorMessage: "Plantilla no disponible",
    });
    await markAutomationInstanceExecuted(client, {
      instanceId: "instance-1",
      versionNumber: 1,
      executedAt: "2026-09-18T22:00:00.000Z",
    });

    expect(client.calls.map((call) => call.functionName)).toEqual([
      "system_set_automation_instance_error",
      "system_mark_automation_instance_executed",
    ]);
  });

  it("locks the SQL contract to versioning, lifecycle and no-retroactivity", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20260918225405_sf164_automation_instances.sql"),
      "utf8",
    );
    const hardening = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260918225521_sf164_automation_instances_time_hardening.sql",
      ),
      "utf8",
    );
    const securityHardening = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260918230311_sf164_automation_instances_security_hardening.sql",
      ),
      "utf8",
    );

    for (const status of ["draft", "active", "paused", "error", "archived"]) {
      expect(migration).toContain(`'${status}'`);
    }

    expect(migration).toContain("automation_instance_versions_instance_version_unique");
    expect(migration).toContain("automation_instances_current_version_fkey");
    expect(migration).toContain("deferrable initially deferred");
    expect(migration).toContain("automation_instances_single_template_unique");
    expect(migration).toContain("'AUT-CAT-04', 'AUT-CAT-13'");
    expect(migration).toContain("automation_configuration_key_not_allowed");
    expect(migration).toContain("automation_instance_system_managed");
    expect(migration).toContain("automation_instance_delete_forbidden");
    expect(migration).toContain("first_executed_at");
    expect(migration).toContain("automations.read");
    expect(migration).toContain("automations.manage");
    expect(migration).toContain("eligible_from reset; no historical backlog");
    expect(migration).toContain("events during pause are not replayed");

    expect(hardening).toContain("clock_timestamp()");
    expect(hardening).toContain("when status = 'active' then v_effective_from");
    expect(hardening).toContain("'reactivated'");
    expect(hardening).toContain("'history preserved'");

    expect(securityHardening).toContain("private.admin_create_automation_instance_internal");
    expect(securityHardening).toContain(
      "private.admin_update_automation_instance_configuration_internal",
    );
    expect(securityHardening).toContain("private.transition_automation_instance_internal");
    expect(securityHardening).toContain(
      "create or replace function public.admin_create_automation_instance",
    );
    expect(securityHardening).toContain("language sql");
    expect(securityHardening).toContain("security invoker");
    expect(securityHardening).toContain("automation_instance_lifecycle_actor_user_idx");
    expect(securityHardening).toContain("automation_instance_versions_created_by_user_idx");
    expect(securityHardening).toContain("automation_instances_created_by_user_idx");
    expect(securityHardening).toContain("automation_instances_updated_by_user_idx");
    expect(securityHardening).toContain("automation_instances_current_version_idx");
  });
});
