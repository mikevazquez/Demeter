export type ContactStage = "prospect" | "trial" | "student" | "former";

export const contactStageLabels: Record<ContactStage, string> = {
  prospect: "Prospecto",
  trial: "Prueba",
  student: "Alumna",
  former: "Exalumna",
};

export function contactStage(student: {
  lifecycle_status: string;
  student_type?: string | null;
  trial_status?: string | null;
  enrollment_status?: "active" | "expired" | "missing";
}): ContactStage {
  if (student.enrollment_status === "expired") return "former";
  if (student.student_type === "trial" && student.trial_status !== "converted") return "trial";
  return "student";
}

export function renewalRecommended(
  stage: ContactStage,
  expiresOn: string | null | undefined,
  today: string,
  sevenDaysFromToday: string,
) {
  return (
    stage === "student" &&
    Boolean(expiresOn && expiresOn >= today && expiresOn <= sevenDaysFromToday)
  );
}

export function channelLabel(channel: string | null | undefined) {
  const labels: Record<string, string> = {
    whatsapp: "WhatsApp",
    instagram: "Instagram",
    facebook: "Facebook",
  };
  return channel ? (labels[channel.toLowerCase()] ?? "Otro canal") : "Sin conversación";
}
