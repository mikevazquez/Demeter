import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("independent Admin and Student PWAs", () => {
  it("gives each portal its own install identity and start URL", () => {
    const manifest = source("app/pwa/manifest/route.ts");
    const adminLayout = source("app/admin/layout.tsx");
    const studentLayout = source("app/student/layout.tsx");

    expect(adminLayout).toContain('portal: "admin"');
    expect(studentLayout).toContain('portal: "student"');
    expect(manifest).toContain('const startUrl = portal === "admin" ? "/admin" : "/student"');
    expect(manifest).toContain('const appName = portal === "admin" ? name + " Admin" : name');
    expect(manifest).toContain('start_url: startUrl');
    expect(manifest).toContain('id: "/pwa/" + slug + "/" + portal');
  });

  it("keeps Admin and Student authentication in different Supabase cookie namespaces", () => {
    const policy = source("lib/supabase/session-policy.ts");
    const browser = source("lib/supabase/client.ts");
    const server = source("lib/supabase/server.ts");
    const proxy = source("lib/supabase/proxy.ts");

    expect(policy).toContain('STUDENT_AUTH_COOKIE_NAME = "demeter-auth-student"');
    expect(policy).toContain('portal === "student" ? { name: STUDENT_AUTH_COOKIE_NAME } : {}');
    expect(browser).toContain("isSingleton: false");
    expect(browser).toContain("authCookieOptions(portal)");
    expect(server).toContain("authCookieOptions(portal)");
    expect(proxy).toContain("authPortalFromPath(request.nextUrl.pathname)");
    expect(proxy).toContain("requestHeaders.set(AUTH_PORTAL_HEADER, portal)");
  });

  it("preserves refreshed cookies and anti-cache headers through the Next.js proxy", () => {
    const proxy = source("lib/supabase/proxy.ts");

    expect(proxy).toContain("const buildResponse = () =>");
    expect(proxy).toContain("setAll(cookiesToSet, responseHeaders)");
    expect(proxy).toContain("request.cookies.set(name, value)");
    expect(proxy).toContain("response = buildResponse()");
    expect(proxy).toContain("response.headers.set(name, value)");
  });

  it("keeps the selected studio durable when reopening the Admin PWA", () => {
    const contextCookie = source("lib/auth/studio-context-cookie.ts");

    expect(contextCookie).toContain("AUTH_COOKIE_MAX_AGE_SECONDS");
    expect(contextCookie).toContain("maxAge: AUTH_COOKIE_MAX_AGE_SECONDS");
  });

  it("never redirects a Student session into Admin just because the account differs", () => {
    const portal = source("lib/student/portal.ts");

    expect(portal).toContain('createClient("student")');
    expect(portal).toContain('!account || account.status !== "active" || !membership');
    expect(portal).not.toContain('redirect("/admin")');
  });

  it("pins admin context and explicit login/logout actions to their portal session", () => {
    const admin = source("lib/auth/admin-context.ts");
    const actions = source("app/auth/actions.ts");

    expect(admin).toContain('createClient("admin")');
    expect(actions).toContain('const authPortal = mode === "student" ? "student" : "admin"');
    expect(actions).toContain("createClient(authPortal)");
    expect(actions).toContain('const portal = mode === "student" ? "student" : "admin"');
    expect(actions).toContain("createClient(portal)");
  });
});
