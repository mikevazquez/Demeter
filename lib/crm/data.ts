import "server-only";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { projectContact } from "./projection";
import { cache } from "react";
// Range pagination prevents the Supabase default row limit from silently hiding contacts.
export const loadCrm = cache(async () => {
  const context = await getAdminContext(CAPABILITIES.STUDENTS_READ);
  const { supabase, studio } = context;
  async function rows(table: string, select: string) {
    const all: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .eq("studio_id", studio.id)
        .order("id")
        .range(offset, offset + 499);
      if (error) throw new Error(`crm_read_failed:${table}:${error.code}`);
      all.push(...(data as unknown as Record<string, unknown>[]));
      if (!data || data.length < 500) return all;
    }
  }
  const [
    students,
    contacts,
    people,
    phones,
    enrollments,
    packages,
    followups,
    conversations,
    reservations,
    intents,
  ] = await Promise.all([
    rows(
      "students",
      "id,person_id,full_name,email,phone,student_type,trial_status,created_at,archived_at",
    ),
    rows("crm_contacts", "id,person_id,source,created_at,converted_student_id"),
    rows("persons", "id,first_name,last_name"),
    rows("person_contacts", "id,person_id,kind,value,is_primary"),
    rows("student_enrollments", "id,student_id,status,starts_on,expires_on,refunded_at"),
    rows("product_acquisitions", "id,student_id,status,starts_on,expires_on,refunded_at"),
    rows("crm_followups", "*"),
    rows(
      "crm_conversations",
      "id,student_id,crm_contact_id,channel,started_at,last_activity_at,activity_count",
    ),
    context.can(CAPABILITIES.SCHEDULE_READ)
      ? rows("reservations", "id,student_id,status,commercial_status,booked_at")
      : Promise.resolve([] as Record<string, unknown>[]),
    context.can(CAPABILITIES.SALES_READ)
      ? rows("assistant_enrollment_intents", "id,student_id,status,created_at")
      : Promise.resolve([] as Record<string, unknown>[]),
  ]);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: studio.timezone || "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const identities = new Set<string>();
  for (const s of students) if (!s.archived_at && s.person_id) identities.add(String(s.person_id));
  for (const c of contacts)
    if (
      !c.converted_student_id ||
      students.some((s) => s.id === c.converted_student_id && !s.archived_at)
    )
      identities.add(String(c.person_id));
  const result = [...identities].map((id) => {
    const s = students.find((s) => s.person_id === id && !s.archived_at);
    const c = contacts.find((c) => c.person_id === id);
    const p = people.find((p) => p.id === id);
    const f = followups.find((f) => f.person_id === id);
    const conv = conversations
      .filter((v) => (s && v.student_id === s.id) || (c && v.crm_contact_id === c.id))
      .sort((a, b) => String(b.last_activity_at).localeCompare(String(a.last_activity_at)));
    const phone = phones
      .filter((v) => v.person_id === id && v.kind === "phone")
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))[0];
    const state = projectContact({
      today,
      reservation: reservations
        .filter((v) => v.student_id === s?.id && v.status !== "cancelled")
        .sort((a, b) => String(b.booked_at).localeCompare(String(a.booked_at)))[0] as Parameters<
        typeof projectContact
      >[0]["reservation"],
      paymentStatus: intents
        .filter((v) => v.student_id === s?.id)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]?.status as
        string | undefined,
      studentType: s?.student_type as string,
      trialStatus: s?.trial_status as string,
      enrollments: enrollments.filter((e) => e.student_id === s?.id) as unknown as Parameters<
        typeof projectContact
      >[0]["enrollments"],
      packages: packages.filter((e) => e.student_id === s?.id) as unknown as Parameters<
        typeof projectContact
      >[0]["packages"],
      followup: f as Parameters<typeof projectContact>[0]["followup"],
    });
    const rawChannel = String(conv[0]?.channel || c?.source || "").toLowerCase();
    const channel = rawChannel.includes("whatsapp")
      ? "WhatsApp"
      : rawChannel.includes("instagram")
        ? "Instagram"
        : rawChannel.includes("facebook")
          ? "Facebook"
          : "Sin identificar";
    return {
      id,
      studentId: s ? String(s.id) : null,
      name: String(
        s?.full_name ||
          [p?.first_name, p?.last_name].filter(Boolean).join(" ") ||
          "Contacto sin nombre",
      ),
      phone: String(s?.phone || phone?.value || ""),
      email: String(s?.email || ""),
      channel,
      createdAt: String(conv[0]?.last_activity_at || c?.created_at || s?.created_at),
      state,
      followup: {
        revision: Number(f?.revision || 0),
        prospect_stage: String(f?.prospect_stage || "answering_questions"),
        qualification: state.qualification,
        qualification_reason: state.qualificationReason || "",
        human_reason: (f?.human_reason as string) || "",
        human_summary: String(f?.human_summary || ""),
        location: String(f?.location || ""),
        interest: String(f?.interest || ""),
        notes: String(f?.notes || ""),
        next_action: String(f?.next_action || ""),
        next_action_on: String(f?.next_action_on || ""),
      },
      conversations: conv.map((v) => ({
        id: String(v.id),
        channel: String(v.channel),
        at: String(v.last_activity_at),
        count: Number(v.activity_count),
      })),
    };
  });
  return {
    contacts: result,
    canEdit: context.can(CAPABILITIES.STUDENTS_WRITE),
    studioId: studio.id,
  };
});
export type CrmContact = Awaited<ReturnType<typeof loadCrm>>["contacts"][number];
