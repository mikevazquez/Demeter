import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // The public Meta sandbox hostname is reserved exclusively for Meta's signed webhook.
  // Do not expose the rest of the admin or API surface through this custom domain.
  if (request.nextUrl.hostname.toLowerCase() === "meta-sandbox.demeterfitness.com") {
    if (request.nextUrl.pathname !== "/api/integrations/meta-inbox/webhook") {
      return new NextResponse("Not Found", { status: 404 });
    }
    if (request.method !== "GET" && request.method !== "POST") {
      return new NextResponse("Method Not Allowed", { status: 405 });
    }
    return NextResponse.next();
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|apple-icon|pwa/icon|pwa/manifest|pwa/studio-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
