import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("profile avatar upload hotfix", () => {
  const profile = source("app/student/perfil/page.tsx");
  const picker = source("app/student/perfil/AvatarFilePicker.tsx");
  const actions = source("app/student/actions.ts");
  const migration = source(
    "supabase/migrations/20260920054000_n14_profile_avatar_activity_colors.sql",
  );
  const storageHotfix = source(
    "supabase/migrations/20260923222000_profile_avatar_storage_rls_hotfix.sql",
  );

  it("uploads avatars directly from the browser instead of sending file bytes through a Server Action", () => {
    expect(profile).toContain("AvatarFilePicker");
    expect(profile).not.toContain("action={updateStudentAvatarAction}");
    expect(picker).toContain('createClient("student")');
    expect(picker).toContain('.from("profile-avatars")');
    expect(picker).toContain(".upload(avatarPath, file");
    expect(picker).toContain("MAX_AVATAR_SIZE = 5 * 1024 * 1024");
    expect(picker).toContain("finalizeStudentAvatarAction(avatarPath)");
    expect(actions).toContain("export async function finalizeStudentAvatarAction");
    expect(actions).not.toContain('formData.get("avatar")');
  });

  it("shows a clear selected-file state before saving", () => {
    expect(picker).toContain("Cargar foto");
    expect(picker).toContain("event.target.files?.[0]");
    expect(picker).toContain("text-sky-400");
    expect(picker).toContain("underline");
    expect(picker).toContain("inputRef.current?.click()");
    expect(picker).toContain('aria-live="polite"');
  });

  it("keeps the storage bucket aligned with the 5 MB UI limit", () => {
    expect(migration).toContain("5242880");
    expect(migration).toContain("array['image/jpeg','image/png','image/webp']");
  });

  it("keeps document storage authorization behind a narrow security-definer guard", () => {
    expect(storageHotfix).toContain(
      "create or replace function public.can_read_studio_document_object",
    );
    expect(storageHotfix).toContain("security definer");
    expect(storageHotfix).toContain("public.can_read_studio_document_object(name)");
    expect(storageHotfix).toContain("private.document_version_applies_to_student(dv.id,s.id,null)");
    expect(storageHotfix).not.toContain(
      "grant execute on function private.document_version_applies_to_student",
    );
  });
});
