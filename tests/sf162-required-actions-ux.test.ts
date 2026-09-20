import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-162 required actions UX", () => {
  it("adds canonical required-actions capabilities and navigation", () => {
    const capabilities = source("lib/auth/capabilities.ts");
    const layout = source("app/admin/layout.tsx");

    expect(capabilities).toContain('REQUIRED_ACTIONS_READ: "required_actions.read"');
    expect(capabilities).toContain('REQUIRED_ACTIONS_MANAGE: "required_actions.manage"');
    expect(layout).toContain('href: "/admin/acciones"');
    expect(layout).toContain("CAPABILITIES.REQUIRED_ACTIONS_READ");
  });

  it("provides one filterable inbox and one canonical detail entity", () => {
    const inbox = source("app/admin/acciones/page.tsx");
    const detail = source("app/admin/acciones/[actionId]/page.tsx");

    expect(inbox).toContain('name="status"');
    expect(inbox).toContain('name="priority"');
    expect(inbox).toContain('name="assignee"');
    expect(inbox).toContain("href={`/admin/acciones/${action.id}`}");
    expect(detail).toContain("Trazabilidad de la acción");
    expect(detail).toContain("required_action_audit");
  });

  it("uses the approved pending and popup primitives for mutations", () => {
    const detail = source("app/admin/acciones/[actionId]/page.tsx");
    const dialog = source("app/admin/acciones/[actionId]/RequiredActionNoticeDialog.tsx");

    expect(detail).toContain("PendingActionButton");
    expect(detail).toContain("Motivo obligatorio de descarte");
    expect(dialog).toContain("NoticeDialog");
    expect(dialog).toContain('tone="error"');
  });

  it("maps assignment, taking, resolution and discard to SF-161 RPCs", () => {
    const actions = source("app/admin/acciones/actions.ts");

    expect(actions).toContain('rpc("admin_assign_required_action"');
    expect(actions).toContain('rpc("admin_take_required_action"');
    expect(actions).toContain('rpc("admin_resolve_required_action"');
    expect(actions).toContain('rpc("admin_discard_required_action"');
    expect(actions).toContain("required_action_discard_reason_required");
  });

  it("integrates the same action detail from Today, Class and Student Profile", () => {
    const context = source("app/admin/acciones/RequiredActionContextPanel.tsx");
    const today = source("app/admin/page.tsx");
    const session = source("app/admin/agenda/[sessionId]/page.tsx");
    const student = source("app/admin/alumnas/[studentId]/page.tsx");

    expect(context).toContain("href={`/admin/acciones/${action.id}`}");
    expect(today).toContain("href={`/admin/acciones/${action.id}`}");
    expect(today).toContain("Atención");
    expect(session).toContain("RequiredActionContextPanel");
    expect(student).toContain("RequiredActionContextPanel");
    expect(session).toContain('.eq("class_session_id", sessionId)');
    expect(student).toContain('.eq("student_id", student.id)');
  });
});
