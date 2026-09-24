"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/admin/recompensas", label: "Inicio", exact: true },
  { href: "/admin/recompensas/programas", label: "Programas" },
  { href: "/admin/recompensas/logros", label: "Logros" },
  { href: "/admin/recompensas/seguimiento", label: "Seguimiento" },
  { href: "/admin/recompensas/generadas", label: "Recompensas" },
];

export function RewardsNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Progress & Rewards"
      className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-black/20 p-2"
    >
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition ${
              active
                ? "bg-[#FF0A8A] text-white"
                : "text-zinc-400 hover:bg-white/[0.05] hover:text-white"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function RewardsShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="dashboard-shell space-y-6 admin-ux04-secondary rewards-admin-page">
      <RewardsNav />
      {children}
    </main>
  );
}
