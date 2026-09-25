import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";

import PwaBrandingSync from "@/app/components/PwaBrandingSync";
import { getStudentPortalContext } from "@/lib/student/portal";

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
  const [{ snapshot, supabase }, brand] = await Promise.all([
    getStudentPortalContext(),
    getPwaBrand(),
  ]);
  const query = pwaBrandQuery(brand);
  const { count: unreadNotificationCount } = await supabase
    .from("app_notifications")
    .select("id", { count: "exact", head: true })
    .eq("student_id", snapshot.profile.student_id)
    .eq("recipient_kind", "student")
    .is("read_at", null);

  return (
    <div className="student-shell min-h-screen bg-[#090a0f] text-white">
      <PwaBrandingSync
        name={brand.name}
        manifestHref={"/pwa/manifest?" + query}
        appleTouchIconHref={"/pwa/studio-icon/180?" + query}
      />

      <header className="sticky top-0 z-40 hidden border-b border-white/10 bg-[#0d0e14]/92 backdrop-blur-xl lg:block">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link href="/student" className="min-w-0" aria-label="Ir a Inicio">
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-white">DEMETER</p>
          </Link>

          <div className="flex items-center gap-2">
            <Link
              href="/student/notificaciones"
              aria-label="Notificaciones"
              title="Notificaciones"
              className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.025] text-zinc-300 transition hover:border-fuchsia-500/35 hover:bg-fuchsia-500/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500"
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
              {(unreadNotificationCount ?? 0) > 0 ? (
                <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-fuchsia-500 px-1.5 py-0.5 text-center text-[10px] font-bold leading-4 text-white">
                  {(unreadNotificationCount ?? 0) > 9 ? "9+" : unreadNotificationCount}
                </span>
              ) : null}
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-0 pb-32 pt-0 sm:px-6 lg:px-8 lg:pb-10 lg:pt-6">
        <StudentNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
