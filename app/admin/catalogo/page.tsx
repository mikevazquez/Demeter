import { Bricolage_Grotesque, Figtree } from "next/font/google";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import PoleCatalogClient from "./pole-catalog-client";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-catalog-display",
});

const body = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-catalog-body",
});

export default async function PoleCatalogPage() {
  await getAdminContext(CAPABILITIES.EVALUATIONS_READ);

  return (
    <div className={`${display.variable} ${body.variable}`} style={{ fontFamily: "var(--font-catalog-body)" }}>
      <PoleCatalogClient />
    </div>
  );
}
