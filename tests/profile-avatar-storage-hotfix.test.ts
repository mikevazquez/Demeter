import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("profile avatar storage regression hotfix", () => {
  it("shows the selected file name as a blue preview link before saving", () => {
    const uploader = source("app/student/perfil/StudentAvatarUploadForm.tsx");
    const profile = source("app/student/perfil/page.tsx");

    expect(profile).toContain("StudentAvatarUploadForm");
    expect(uploader).toContain("Cargar foto");
    expect(uploader).toContain("selectedFile.name");
    expect(uploader).toContain("text-sky-400");
    expect(uploader).toContain("URL.createObjectURL");
    expect(uploader).toContain("disabled={!selectedFile}");
  });

  it("keeps DOCUMENTOS storage authorization behind a narrow executable predicate", () => {
    const migration = source(
      "supabase/migrations/20260923222500_documents_storage_policy_avatar_hotfix.sql",
    );

    expect(migration).toContain("private.can_read_studio_document_object");
    expect(migration).toContain("security definer");
    expect(migration).toContain("grant execute on function private.can_read_studio_document_object(text)");
    expect(migration).toContain("bucket_id = 'studio-documents'");
    expect(migration).toContain("private.can_read_studio_document_object(name)");
  });

  it("refreshes both profile and home after a successful avatar update", () => {
    const actions = source("app/student/actions.ts");
    const avatarAction = actions.slice(actions.indexOf("export async function updateStudentAvatarAction"));

    expect(avatarAction).toContain('revalidatePath("/student")');
    expect(avatarAction).toContain('revalidatePath("/student/perfil")');
  });
});
