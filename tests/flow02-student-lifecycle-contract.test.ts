import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Flow 02 student lifecycle", () => {
  it("keeps inactive reversible and deleted irreversible", () => {
    const migration = source("supabase/migrations/20260918193000_flow02_student_lifecycle.sql");

    expect(migration).toContain("student_lifecycle_events");
    expect(migration).toContain("p_status not in ('active','inactive')");
    expect(migration).toContain("raise exception 'student_deleted'");
    expect(migration).toContain("admin_delete_student");
    expect(migration).toContain("full_name = 'Alumna eliminada'");
    expect(migration).toContain("phone = null");
    expect(migration).toContain("email = null");
  });

  it("cancels future reservations as studio cancellations without consuming credit", () => {
    const migration = source("supabase/migrations/20260918193000_flow02_student_lifecycle.sql");

    expect(migration).toContain("cancel_future_student_reservations");
    expect(migration).toContain("status = 'cancelled_by_studio'");
    expect(migration).toContain("'release'");
    expect(migration).toContain("cs.starts_at > now()");
    expect(migration).not.toContain(
      "movement_type, quantity, reservation_id, note, created_by\n      ) values (\n        v_reservation.studio_id,\n        v_reservation.acquisition_id,\n        'consume'",
    );
  });

  it("removes deleted students from operational navigation", () => {
    const list = source("app/admin/alumnas/page.tsx");
    const profile = source("app/admin/alumnas/[studentId]/page.tsx");
    const onboarding = source("app/admin/alumnas/[studentId]/alta/page.tsx");
    const reserve = source("app/admin/alumnas/[studentId]/reservar/page.tsx");

    expect(list).not.toContain('<option value="archived">');
    expect(list).toContain('["active", "inactive"]');
    expect(profile).toContain('.neq("lifecycle_status", "archived")');
    expect(onboarding).toContain('.neq("lifecycle_status", "archived")');
    expect(reserve).toContain('.neq("lifecycle_status", "archived")');
  });

  it("requires explicit confirmation and pending feedback", () => {
    const controls = source("app/admin/alumnas/[studentId]/StudentLifecycleControls.tsx");

    expect(controls).toContain("¿Inactivar a esta alumna?");
    expect(controls).toContain("¿Eliminar a esta alumna?");
    expect(controls).toContain("Esta acción no se puede deshacer");
    expect(controls).toContain("Cancelar");
    expect(controls).toContain('pendingLabel="Inactivando…"');
    expect(controls).toContain('pendingLabel="Eliminando…"');
    expect(controls).toContain("PendingActionButton");
  });

  it("keeps lifecycle results in contextual dialogs", () => {
    const dialog = source("app/admin/alumnas/LifecycleNoticeDialog.tsx");

    expect(dialog).toContain("NoticeDialog");
    expect(dialog).toContain("El expediente quedó inactivo");
    expect(dialog).toContain("El expediente vuelve a estar activo");
    expect(dialog).toContain("El expediente fue eliminado de la operación");
    expect(dialog).toContain('url.searchParams.delete("lifecycle")');
  });

  it("allows a future alta without resurrecting deleted student records", () => {
    const listActions = source("app/admin/alumnas/actions.ts");
    const migration = source(
      "supabase/migrations/20260918193000_flow02_student_lifecycle.sql",
    );

    expect(listActions).toContain('.neq("lifecycle_status", "archived")');
    expect(migration).toContain("v_person_id is not null and exists");
    expect(migration).toContain("s.lifecycle_status <> 'archived'");
    expect(migration).toContain("returning id into v_student_id");
  });

  it("replaces stale deleted-student auth before provisioning fresh access", () => {
    const provision = source("supabase/functions/provision-student-access/index.ts");

    expect(provision).toContain("staleUser");
    expect(provision).toContain("linkedStudents");
    expect(provision).toContain('neq("lifecycle_status", "archived")');
    expect(provision).toContain("admin.deleteUser(staleUser.id)");
    expect(provision).toContain("provisionedUser");
  });
});
