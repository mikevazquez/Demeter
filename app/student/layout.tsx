import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";

import { signOut } from "@/app/auth/actions";
import { STUDIO_MODULES } from "@/lib/auth/modules";
import { getStudentPortalContext } from "@/lib/student/portal";

import PendingActionButton from "./components/PendingActionButton";
import PwaBrandingSync from "@/app/components/PwaBrandingSync";
import { StudentNav } from "./StudentNav";

type PwaBrand = {
  name: string;
  slug: string;
  primary_color: string;
  logo_path: string | null;
};

function pwaBrandQuery(brand: PwaBrand) {
  return new URLSearchParams({
    name: brand.name,
    slug: brand.slug,
    primary: brand.primary_color,
    logo: brand.logo_path ?? "",
    v: "3",
  }).toString();
}

const getPwaBrand = cache(async (): Promise<PwaBrand> => {
  const { membership, studio, supabase } = await getStudentPortalContext();
  const { data: brand } = await supabase
    .from("studios")
    .select("name,slug,primary_color,logo_path")
    .eq("id", membership.studio_id)
    .maybeSingle();

  return (
    brand ?? {
      name: studio.name,
      slug: "studio",
      primary_color: "#FF0A8A",
      logo_path: null,
    }
  );
});

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getPwaBrand();
  const query = pwaBrandQuery(brand);

  return {
    applicationName: brand.name,
    title: brand.name,
    manifest: "/pwa/manifest?" + query,
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: brand.name,
    },
    icons: {
      icon: [
        {
          url: "/pwa/studio-icon/192?" + query,
          sizes: "192x192",
          type: "image/png",
        },
        {
          url: "/pwa/studio-icon/512?" + query,
          sizes: "512x512",
          type: "image/png",
        },
      ],
      apple: [
        {
          url: "/pwa/studio-icon/180?" + query,
          sizes: "180x180",
          type: "image/png",
        },
      ],
    },
  };
}

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const [{ snapshot, studio, hasModule }, brand] = await Promise.all([
    getStudentPortalContext(),
    getPwaBrand(),
  ]);
  const query = pwaBrandQuery(brand);

  return (
    <div className="min-h-screen bg-[#090a0f] text-white">
      <PwaBrandingSync
        name={brand.name}
        manifestHref={"/pwa/manifest?" + query}
        appleTouchIconHref={"/pwa/studio-icon/180?" + query}
      />

      <header className="border-b border-white/10 bg-[#0d0e14]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/student" className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-fuchsia-300">
              Studio Flow
            </p>
            <p className="truncate text-sm font-semibold text-white">{studio.name}</p>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            {hasModule(STUDIO_MODULES.NOTIFICATIONS) ? (
              <Link
                href="/student/notificaciones"
                aria-label="Notificaciones"
                title="Notificaciones"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#D4AF37]/30 text-[#D4AF37] transition hover:border-[#D4AF37]/50 hover:bg-[#D4AF37]/10 hover:text-[#E6C85C]"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="h-5 w-5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
                  <path d="M13.7 21a2 2 0 0 1-3.4 0" />
                </svg>
              </Link>
            ) : null}
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-white">{snapshot.profile.first_name}</p>
              <p className="text-xs text-zinc-500">Portal de alumna</p>
            </div>
            <form action={signOut}>
              <PendingActionButton
                pendingLabel="Saliendo…"
                className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:bg-white/[0.05] hover:text-white disabled:cursor-wait disabled:opacity-60"
              >
                Salir
              </PendingActionButton>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 pb-32 pt-6 sm:px-6 lg:px-8 lg:pb-10">
        <StudentNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
