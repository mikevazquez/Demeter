import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("DEV-02 provisioning", () => {
  const setupPage = source("app/setup/page.tsx");
  const setupAction = source("app/setup/actions.ts");
  const setupForm = source("app/setup/ProvisionStudioForm.tsx");
  const authActions = source("app/auth/actions.ts");
  const provisionStudio = source("supabase/functions/provision-studio/index.ts");
  const platformMigration = source(
    "supabase/migrations/20260925233906_dev_02_platform_admin_and_studio_activation.sql",
  );
  const provisionMigration = source(
    "supabase/migrations/20260925234106_dev_02_service_provision_studio.sql",
  );
  const activationFix = source(
    "supabase/migrations/20260925234432_dev_02_owner_activation_flag_fix.sql",
  );
  const rollbackMigration = source(
    "supabase/migrations/20260926002027_dev_02_safe_empty_studio_rollback.sql",
  );

  it("protects setup behind platform admin access", () => {
    expect(setupPage).toContain('from("platform_admins")');
    expect(setupPage).toContain('redirect("/")');
    expect(platformMigration).toContain("platform_admin_self_read");
  });

  it("creates a tenant with both location models and a primary space", () => {
    expect(provisionMigration).toContain("insert into public.studios");
    expect(provisionMigration).toContain("insert into public.sites");
    expect(provisionMigration).toContain("insert into public.studio_locations");
    expect(provisionMigration).toContain("insert into public.spaces");
    expect(provisionMigration).toContain("'owner'");
  });

  it("keeps raw provisioning service out of anon and authenticated roles", () => {
    expect(provisionMigration).toContain(
      "from public,anon,authenticated",
    );
    expect(provisionMigration).toContain("to service_role");
  });

  it("requires a platform admin before the edge function provisions a studio", () => {
    expect(provisionStudio).toContain('from("platform_admins")');
    expect(provisionStudio).toContain('{ error: "forbidden" }');
    expect(provisionStudio).toContain('"service_provision_studio"');
  });

  it("reuses an existing owner account without deleting or resetting it", () => {
    expect(provisionStudio).toContain("reusedExistingAccount");
    expect(provisionStudio).toContain("ownerRequiresActivation = account.must_change_password === true");
    expect(activationFix).toContain(
      "else public.user_accounts.must_change_password",
    );
  });

  it("forces activation for a newly created owner", () => {
    expect(provisionStudio).toContain("createdOwnerUser = true");
    expect(provisionStudio).toContain("ownerRequiresActivation = true");
    expect(activationFix).toContain(
      "when coalesce(p_owner_requires_activation,true) then true",
    );
  });

  it("allows owner, admin, and instructor accounts to finish studio password activation", () => {
    expect(authActions).toContain(
      '["owner", "admin", "instructor"].includes(membership.role)',
    );
    expect(authActions).toContain('"studio_complete_password_activation"');
    expect(platformMigration).toContain("sm.role in ('owner','admin')");
    expect(platformMigration).toContain("sm.role='instructor'");
  });

  it("keeps activation links in action state instead of URL query params", () => {
    expect(setupAction).toContain("activationLink");
    expect(setupForm).toContain("state.activationLink");
    expect(setupPage).not.toContain("activationLink");
  });

  it("supports safe rollback only while a provisioned studio is still empty", () => {
    expect(rollbackMigration).toContain("service_delete_empty_studio");
    expect(rollbackMigration).toContain("raise exception 'studio_not_empty'");
    expect(rollbackMigration).toContain("delete from public.notification_rules");
    expect(rollbackMigration).toContain("delete from public.studios");
    expect(rollbackMigration).toContain("to service_role");
  });
});
