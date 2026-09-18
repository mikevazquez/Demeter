import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("student catalog checkout production fixes", () => {
  it("keeps package term groups collapsed by default", () => {
    const page = source("app/student/paquete/page.tsx");

    expect(page).toContain('name="package-term-catalog"');
    expect(page).toContain("<details");
    expect(page).not.toContain("<details open");
  });

  it("persists checkout failure stages and surfaces safe error codes", () => {
    const edge = source("supabase/functions/create-mercadopago-order/index.ts");
    const actions = source("app/student/actions.ts");

    expect(edge).toContain('createClient(supabaseUrl, serviceRoleKey');
    expect(edge).toContain('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")');
    expect(edge).not.toContain("context.supabaseAdmin");
    expect(edge).toContain("markAttemptFailure");
    expect(edge).toContain('markAttemptFailure("mercadopago_not_configured")');
    expect(edge).toContain('markAttemptFailure("mercadopago_unreachable")');
    expect(actions).toContain("edgeFunctionErrorCode");
    expect(actions).toContain("context.clone().json()");
  });
});
