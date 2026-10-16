import { NextResponse } from "next/server";

import { getMetaWhatsAppAdminDiagnostics } from "@/lib/assistant/meta-whatsapp-admin";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return new NextResponse(null, { status: 404 });
  }

  const service = createServiceClient();
  const { data: studio, error } = await service
    .from("studios")
    .select("id")
    .eq("slug", "demeter-fitness")
    .maybeSingle();

  if (error || !studio?.id) {
    return NextResponse.json({ ok: false, error: "studio_not_found" }, { status: 500 });
  }

  const diagnostics = await getMetaWhatsAppAdminDiagnostics(studio.id);
  const mappedName = diagnostics.templateMappings.student_welcome ?? null;
  const template = mappedName
    ? diagnostics.templates.find(
        (item) => item.name === mappedName && item.language === diagnostics.templateLanguage,
      ) ?? diagnostics.templates.find((item) => item.name === mappedName) ?? null
    : null;

  return NextResponse.json({
    ok: diagnostics.connected,
    errorCode: diagnostics.errorCode,
    templateLanguage: diagnostics.templateLanguage,
    mappedTemplateName: mappedName,
    template,
  });
}
