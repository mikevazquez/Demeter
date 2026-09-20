import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-N14-H01 profile avatar and activity colors", () => {
  const migration = source(
    "supabase/migrations/20260920054000_n14_profile_avatar_activity_colors.sql",
  );
  const profile = source("app/student/perfil/page.tsx");
  const avatar = source("app/student/perfil/ProfileAvatarUploader.tsx");
  const agenda = source("app/admin/agenda/page.tsx");
  const agendaActions = source("app/admin/agenda/recurring-actions.ts");
  const studentSchedule = source("app/student/reservar/page.tsx");

  it("creates a private avatar bucket with size, mime and owner-folder policies", () => {
    expect(migration).toContain("'profile-avatars'");
    expect(migration).toContain("false,");
    expect(migration).toContain("5242880");
    expect(migration).toContain("image/jpeg");
    expect(migration).toContain("image/png");
    expect(migration).toContain("image/webp");
    expect(migration).toContain("profile_avatars_select_own");
    expect(migration).toContain("profile_avatars_insert_own");
    expect(migration).toContain("profile_avatars_update_own");
    expect(migration).toContain("(storage.foldername(name))[1]");
    expect(migration).toContain("(select auth.uid())::text");
  });

  it("lets the signed-in student upload and display her own profile photo", () => {
    expect(profile).toContain('select("avatar_url")');
    expect(profile).toContain('createSignedUrl(accountProfile.avatar_url, 3600)');
    expect(profile).toContain("ProfileAvatarUploader");
    expect(avatar).toContain('from("profile-avatars")');
    expect(avatar).toContain(".upload(avatarPath, file");
    expect(avatar).toContain('from("profiles")');
    expect(avatar).toContain("avatar_url: avatarPath");
    expect(avatar).toContain("5 * 1024 * 1024");
    expect(avatar).toContain('"image/jpeg"');
    expect(avatar).toContain('"image/png"');
    expect(avatar).toContain('"image/webp"');
  });

  it("persists a validated color per activity and exposes it in admin", () => {
    expect(migration).toContain("add column if not exists color_hex");
    expect(migration).toContain("^#[0-9A-Fa-f]{6}$");
    expect(agenda).toContain('select("id,name,duration_minutes,capacity,discipline_id,credit_cost,drop_in_price_minor,color_hex")');
    expect(agenda).toContain('type="color"');
    expect(agenda).toContain("updateActivityColor");
    expect(agendaActions).toContain("normalizeColorHex");
    expect(agendaActions).toContain('.update({ color_hex: colorHex })');
    expect(agendaActions).toContain('.eq("studio_id", studio.id)');
  });

  it("seeds the requested visual references in Sandbox/Production migration", () => {
    expect(migration).toContain("when 'twerk' then '#AE51BB'");
    expect(migration).toContain("when 'pole fitness' then '#0877B9'");
    expect(migration).toContain("when 'exotic pole' then '#D52473'");
    expect(migration).toContain("when 'heels' then '#D1A340'");
    expect(migration).toContain("when 'yoga' then '#AD9ACD'");
    expect(migration).toContain("when 'espiral' then '#B2CC0B'");
    expect(migration).toContain("when 'danza aérea' then '#07C0B3'");
  });

  it("reflects the configured activity color in admin and student schedules", () => {
    expect(agenda).toContain("borderLeftColor: template?.color_hex");
    expect(agenda).toContain("templateMap.get(schedule.template_id)?.color_hex");
    expect(studentSchedule).toContain('.select("name,color_hex")');
    expect(studentSchedule).toContain("activityColorMap");
    expect(studentSchedule).toContain("borderLeftColor: activityColor");
    expect(studentSchedule).toContain("style={{ color: activityColor }}");
  });
});
