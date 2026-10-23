"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { BIRTHDAY_BOOKING_ERRORS, normalizeBirthdayFriendPhone } from "@/lib/birthday/pass";
import { getStudentPortalContext } from "@/lib/student/portal";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function knownCode(message: string | null | undefined) {
  if (!message) return "birthday_booking_failed";
  return (
    Object.keys(BIRTHDAY_BOOKING_ERRORS).find((code) => message.includes(code)) ??
    "birthday_booking_failed"
  );
}

/** CUMP-01-06 · Reserva una clase con el pase de cumpleaños, para ella o para una amiga. */
export async function bookWithBirthdayPassAction(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "").trim();
  const rawDate = String(formData.get("date") ?? "").trim();
  const recipient = String(formData.get("recipient") ?? "self") === "friend" ? "friend" : "self";
  const friendName = String(formData.get("friend_name") ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
  const friendPhoneRaw = String(formData.get("friend_phone") ?? "");
  const dateQuery = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? `&date=${rawDate}` : "";

  if (!UUID.test(sessionId)) redirect("/student/reservar?error=session_required");
  const back = (params: string) =>
    redirect(`/student/reservar/${sessionId}/cumpleanos?${params}${dateQuery}`);

  let friendPhone: string | null = null;
  if (recipient === "friend") {
    if (!friendName) back("error=friend_name_required&para=amiga");
    friendPhone = normalizeBirthdayFriendPhone(friendPhoneRaw);
    if (!friendPhone) back("error=friend_phone_invalid&para=amiga");
  }

  const { supabase } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_book_with_birthday_pass", {
    target_session_id: sessionId,
    target_for: recipient,
    target_friend_name: recipient === "friend" ? friendName : null,
    target_friend_phone: recipient === "friend" ? friendPhone : null,
  });

  const result = (data ?? null) as { ok?: boolean; reason_code?: string } | null;
  if (error || !result?.ok) {
    const code = knownCode(error?.message ?? result?.reason_code);
    back(`error=${encodeURIComponent(code)}${recipient === "friend" ? "&para=amiga" : ""}`);
  }

  revalidatePath("/student");
  revalidatePath("/student/reservar");
  revalidatePath("/student/mis-clases");
  back(`listo=${recipient === "friend" ? "amiga" : "propia"}`);
}
