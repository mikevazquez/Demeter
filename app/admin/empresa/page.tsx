import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

export default async function CompanyCompatibilityPage() {
  await getAdminContext(CAPABILITIES.ADMIN_PORTAL);
  redirect("/admin/mas");
}
