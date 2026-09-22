import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type CheckInResult = {
  ok?: boolean;
  status?: string;
  [key: string]: unknown;
};

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, status: "invalid_request" }, { status: 400 });
  }

  const token =
    typeof body === "object" &&
    body !== null &&
    "token" in body &&
    typeof (body as { token?: unknown }).token === "string"
      ? (body as { token: string }).token.trim()
      : "";

  if (!token || token.length > 200) {
    return NextResponse.json({ ok: false, status: "invalid_request" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, status: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("check_in_reservation", {
    p_token: token,
  });

  if (error) {
    if (error.message.includes("forbidden")) {
      return NextResponse.json({ ok: false, status: "forbidden" }, { status: 403 });
    }

    console.error("KIOSCO-01 check-in failed", {
      code: error.code,
      message: error.message,
    });

    return NextResponse.json({ ok: false, status: "server_error" }, { status: 500 });
  }

  return NextResponse.json((data ?? { ok: false, status: "server_error" }) as CheckInResult, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
