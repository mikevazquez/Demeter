import { NextResponse } from "next/server";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

function transparentAvatar() {
  return new Response(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>',
    {
      headers: {
        "content-type": "image/svg+xml",
        "cache-control": "no-store",
      },
    },
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ studentId: string }> },
) {
  try {
    const { studentId } = await params;
    const { supabase, studio } = await getAdminContext(CAPABILITIES.STUDENTS_READ);

    const { data: student } = await supabase
      .from("students")
      .select("user_id,lifecycle_status")
      .eq("id", studentId)
      .eq("studio_id", studio.id)
      .maybeSingle();

    if (!student?.user_id || student.lifecycle_status === "archived") {
      return transparentAvatar();
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", student.user_id)
      .maybeSingle();

    if (!profile?.avatar_url) return transparentAvatar();

    const { data, error } = await supabase.storage
      .from("profile-avatars")
      .createSignedUrl(profile.avatar_url, 300);

    if (error || !data?.signedUrl) return transparentAvatar();

    return NextResponse.redirect(data.signedUrl);
  } catch {
    return transparentAvatar();
  }
}
