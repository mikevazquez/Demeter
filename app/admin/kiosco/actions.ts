"use server";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
export async function verifyKioskExit(pin: string) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.ATTENDANCE_WRITE);
  const { data, error } = await supabase.rpc("verify_kiosk_pin", {
    target_studio_id: studio.id,
    pin,
  });
  return error ? { ok: false } : (data as { ok: boolean; blocked?: boolean });
}
