import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import { KioskScanner } from "./KioskScanner";

export default async function AdminKioskPage() {
  const { studio } = await getAdminContext(CAPABILITIES.ATTENDANCE_WRITE);

  return (
    <KioskScanner
      studioName={studio.name}
      locale={studio.locale}
      timeZone={studio.timezone}
    />
  );
}
