import type { SupabaseClient } from "@supabase/supabase-js";

import { GiftIcon } from "@/app/admin/hoy/GiftIcon";
import { birthdayDateLabel, type AdminBirthdayPass } from "@/lib/birthday/pass";

import "./birthday-pass.css";

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function formatDateTime(value: string | null | undefined, timeZone: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** CUMP-01-08 · Estado del pase de cumpleaños en la ficha (solo durante su mes o si ya lo usó). */
export default async function StudentBirthdayPassCard({
  supabase,
  studentId,
  timeZone,
}: {
  supabase: SupabaseClient;
  studentId: string;
  timeZone: string;
}) {
  const { data, error } = await supabase.rpc("admin_student_birthday_pass", {
    p_student_id: studentId,
  });
  if (error || !data) return null;
  const info = data as AdminBirthdayPass;
  if (!info.has_birth_date || (!info.in_birthday_month && !info.pass)) return null;

  const pass = info.pass ?? null;
  const monthLabel = info.birthday_month ? MONTHS[info.birthday_month - 1] : null;
  let status: string;
  let detail: string;
  let tone: "gold" | "green" | "muted";

  if (!info.gift_enabled && !pass) {
    status = "Regalo apagado";
    detail = "El estudio tiene apagado el regalo de cumpleaños.";
    tone = "muted";
  } else if (!pass) {
    status = "Por estrenar";
    detail =
      "Su pase de 1 clase se activa cuando entra a su portal o reserva con él durante su mes.";
    tone = "gold";
  } else if (pass.state === "used") {
    const when = formatDateTime(pass.used_starts_at, timeZone);
    status = pass.recipient_kind === "friend" ? "Regalado a una amiga" : "Usado por ella";
    detail = [
      pass.recipient_kind === "friend" ? `Invitada: ${pass.recipient_name ?? "amiga"}` : null,
      pass.used_class_name ? `Clase: ${pass.used_class_name}` : null,
      when,
    ]
      .filter(Boolean)
      .join(" · ");
    tone = "green";
  } else if (pass.state === "expired") {
    status = "Vencido sin usar";
    detail = `Era válido hasta el ${birthdayDateLabel(pass.expires_on) ?? "fin de su mes"}.`;
    tone = "muted";
  } else {
    status = "Disponible";
    detail = `1 clase de regalo, válida hasta el ${birthdayDateLabel(pass.expires_on) ?? "fin de su mes"}. No descuenta de su paquete.`;
    tone = "gold";
  }

  return (
    <section className={`birthday-pass-admin-card is-${tone}`} aria-label="Pase de cumpleaños">
      <span className="birthday-pass-admin-icon">
        <GiftIcon size={20} />
      </span>
      <div className="birthday-pass-admin-copy">
        <p className="eyebrow">
          {info.is_birthday ? "Hoy es su cumpleaños" : `Mes de cumpleaños${monthLabel ? ` · ${monthLabel}` : ""}`}
        </p>
        <strong>Pase de cumpleaños · {status}</strong>
        {detail ? <p>{detail}</p> : null}
      </div>
    </section>
  );
}
