"use client";

import Link from "next/link";
import "./rewards-v2.css";
import { usePathname } from "next/navigation";

const items = [
  { href: "/admin/recompensas", label: "Inicio", exact: true },
  { href: "/admin/recompensas/medallas", label: "Medallas" },
  { href: "/admin/recompensas/programas", label: "Programas" },
  { href: "/admin/recompensas/logros", label: "Logros" },
  { href: "/admin/recompensas/retos", label: "Retos" },
  { href: "/admin/recompensas/seguimiento", label: "Seguimiento" },
  { href: "/admin/recompensas/generadas", label: "Recompensas" },
];

export function RewardsNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Progress & Rewards"
      className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2"
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
                ? "bg-teal-600 text-slate-900"
                : "text-slate-600 hover:bg-white/[0.05] hover:text-slate-900"
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
    <main className="dashboard-shell space-y-6 rewards-admin-page">
      <RewardsNav />
      {children}
    </main>
  );
}
