import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
describe("Equipo notifications sandbox contract", () => {
  const migration = src("supabase/migrations/20261008101500_team_coach_roster_due.sql");
  const engine = src("supabase/functions/notification-engine-worker/index.ts");
  const delivery = src("supabase/functions/notification-delivery-worker/index.ts");
  const catalog = src("lib/notifications/admin-catalog.ts");
  const meta = src("supabase/functions/_shared/meta-whatsapp-template.ts");
  const phone = src("supabase/migrations/20261008093000_instructor_phone_edit.sql");
  it("defaults reminders off with a 120-minute editable lead time", () => {
    expect(migration).toContain("'team.coach_roster_reminder'");
    expect(migration).toContain('"minutes_before":120');
    expect(migration).toContain("enabled=false");
    expect(migration).toContain("*/5 * * * *");
  });
  it("deduplicates by session, not student or booking", () => {
    expect(migration).toContain("'notification:team.coach_roster_due:'||rec.id::text");
    expect(migration).toContain("cs.instructor_id is not null");
    expect(migration).toContain("cs.status='scheduled'");
  });
  it("calculates a current roster from confirmed reservations", () => {
    expect(engine).toContain('event.event_type === "team.coach_roster_due"');
    expect(engine).toContain('.eq("status", "reserved")');
    expect(engine).toContain("payload.roster_count");
    expect(engine).toContain("payload.roster_names");
  });
  it("includes both Meta template arguments and inbox rendering", () => {
    expect(meta).toContain('coach_roster_reminder: ["coach", "clase", "fecha", "hora", "total", "alumnas"]');
    expect(delivery).toContain('case "coach_roster_reminder"');
    expect(catalog).toContain('category: "equipo"');
  });
  it("restores team read/write privileges without exposing records to anon", () => {
    const grants = src("supabase/migrations/20261008112000_fix_instructor_authenticated_grants.sql");
    expect(grants).toContain("grant select, insert, update on table public.instructors to authenticated");
    expect(grants).toContain("grant select, insert, update, delete on table public.instructor_disciplines to authenticated");
    expect(grants).not.toMatch(/grant\\s+.*\\s+to\\s+anon/i);
  });
  it("creates the coach only in the studio selected by the admin", () => {
    const scoped = src("supabase/migrations/20261008113000_scoped_instructor_creation.sql");
    const action = src("app/admin/instructores/actions.ts");
    expect(scoped).toContain("private.has_capability(p_studio_id,'instructors.write')");
    expect(scoped).toContain("security definer");
    expect(action).toContain('rpc("admin_create_instructor_scoped"');
    expect(action).toContain("p_studio_id: studio.id");
  });
  it("requires instructors.write and isolates coach phone to studio", () => {
    expect(phone).toContain("private.has_capability(v_studio_id,'instructors.write')");
    expect(phone).toContain("where studio_id=v_studio_id and person_id=v_person_id");
  });
});
