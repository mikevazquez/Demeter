import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import PoleCatalogClient from "./pole-catalog-client";

export default async function PoleCatalogPage() {
  await getAdminContext(CAPABILITIES.EVALUATIONS_READ);

  return (
    <div className="sendero-catalog">
      <PoleCatalogClient />
    </div>
  );
}
