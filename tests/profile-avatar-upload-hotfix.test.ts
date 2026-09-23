import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("profile avatar upload hotfix", () => {
  const profile = source("app/student/perfil/page.tsx");
  const picker = source("app/student/perfil/AvatarFilePicker.tsx");
  const migration = source(
    "supabase/migrations/20260923222000_profile_avatar_storage_rls_hotfix.sql",
  );

  it("shows a clear selected-file state before saving", () => {
    expect(profile).toContain("AvatarFilePicker");
    expect(picker).toContain("Cargar foto");
    expect(picker).toContain("event.target.files?.[0]?.name");
    expect(picker).toContain("text-sky-400");
    expect(picker).toContain("underline");
    expect(picker).toContain("inputRef.current?.click()");
    expect(picker).toContain('aria-live="polite"');
  });

  it("keeps document storage authorization behind a narrow security-definer guard", () => {
    expect(migration).toContain(
      "create or replace function public.can_read_studio_document_object",
    );
    expect(migration).toContain("security definer");
    expect(migration).toContain("public.can_read_studio_document_object(name)");
    expect(migration).toContain(
      "private.document_version_applies_to_student(dv.id,s.id,null)",
    );
    expect(migration).not.toContain(
      "grant execute on function private.document_version_applies_to_student",
    );
  });
});
