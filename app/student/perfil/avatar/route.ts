import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

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

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return transparentAvatar();

    const { data: profile } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
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
