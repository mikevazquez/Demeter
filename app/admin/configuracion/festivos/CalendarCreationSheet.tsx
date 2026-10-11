"use client";
import { useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import PortalSheet from "@/app/admin/components/PortalSheet";
export default function CalendarCreationSheet({
  year,
  children,
}: {
  year: number;
  children: ReactNode;
}) {
  const router = useRouter();
  const close = useCallback(
    () => router.push(`/admin/configuracion/festivos?year=${year}`, { scroll: false }),
    [router, year],
  );
  return (
    <PortalSheet title="Nueva fecha especial" onClose={close}>
      {children}
    </PortalSheet>
  );
}
