import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("AUTH · persistent device sessions", () => {
  const policy = source("lib/supabase/session-policy.ts");
  const browserClient = source("lib/supabase/client.ts");
  const serverClient = source("lib/supabase/server.ts");
  const proxy = source("lib/supabase/proxy.ts");
  const studentPortal = source("lib/student/portal.ts");
  const adminContext = source("lib/auth/admin-context.ts");
  const login = source("app/login/login-card.tsx");

  it("keeps the auth cookie durable and renews it through all Supabase clients", () => {
    expect(policy).toContain("60 * 60 * 24 * 400");
    expect(browserClient).toContain("AUTH_COOKIE_MAX_AGE_SECONDS");
    expect(serverClient).toContain("AUTH_COOKIE_MAX_AGE_SECONDS");
    expect(proxy).toContain("AUTH_COOKIE_MAX_AGE_SECONDS");
  });

  it("forwards Supabase refresh headers from the proxy", () => {
    expect(proxy).toContain("setAll(cookiesToSet, headers)");
    expect(proxy).toContain("Object.entries(headers)");
    expect(proxy).toContain("response.headers.set");
  });

  it("does not turn temporary backend failures into a false logout", () => {
    expect(studentPortal).toContain("student_auth_temporarily_unavailable");
    expect(studentPortal).toContain("student_access_lookup_temporarily_unavailable");
    expect(adminContext).toContain("admin_auth_temporarily_unavailable");
    expect(adminContext).toContain("admin_access_lookup_temporarily_unavailable");
  });

  it("makes persistence the default instead of showing a non-functional remember checkbox", () => {
    expect(login).toContain("Sesión persistente en este dispositivo");
    expect(login).not.toContain('name="remember"');
  });
});
