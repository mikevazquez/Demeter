export const MAX_PROMPT_LENGTH = 24_000;

export type PromptVersion = {
  id: string;
  kind: "baseline" | "draft" | "activation";
  instructions: string;
  note: string;
  created_at: string;
};

export const TEST_PERSONAS = [
  "prospect",
  "trial_pending_reserved",
  "trial_cancelled",
  "trial_no_show",
  "trial_attended",
  "student",
  "student_reserved",
  "former_student",
  "unresolved_identity",
] as const;

export type TestPersona = (typeof TEST_PERSONAS)[number];

export function isTestPersona(value: unknown): value is TestPersona {
  return typeof value === "string" && TEST_PERSONAS.includes(value as TestPersona);
}

export function testPersonaLabel(persona: TestPersona): string {
  const labels: Record<TestPersona, string> = {
    prospect: "prospecto nuevo",
    trial_pending_reserved: "persona con prueba pendiente y reserva ficticia",
    trial_cancelled: "persona con prueba cancelada",
    trial_no_show: "persona con ausencia a prueba",
    trial_attended: "persona que ya asistió a su prueba",
    student: "alumna activa con paquete ficticio de 8 clases",
    student_reserved: "alumna activa con paquete y reserva ficticios",
    former_student: "exalumna sin paquete activo",
    unresolved_identity: "persona sin identidad resuelta",
  };
  return labels[persona];
}

export function isFirstVisitPersona(persona: TestPersona): boolean {
  return ["prospect", "trial_pending_reserved", "trial_cancelled", "trial_no_show"].includes(
    persona,
  );
}

export function isActiveStudentPersona(persona: TestPersona): boolean {
  return persona === "student" || persona === "student_reserved";
}

export function validPrompt(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_PROMPT_LENGTH;
}

export function promptWorkbenchError(code: string) {
  const messages: Record<string, string> = {
    invalid_prompt: "Escribe las instrucciones de Demi (máximo 24,000 caracteres).",
    invalid_message: "Escribe un mensaje de hasta 2,000 caracteres.",
    assistant_not_configured: "Demi todavía no está configurada.",
    prompt_storage_unavailable: "No se pudo guardar. Tu texto sigue aquí; inténtalo de nuevo.",
    active_prompt_changed: "La versión activa cambió. Recarga y revisa antes de activar.",
    draft_changed: "El borrador cambió. Inicia una nueva conversación para probarlo.",
    conversation_not_found: "La prueba ya no está disponible. Inicia una nueva conversación.",
    openai_not_configured: "Falta configurar la conexión con IA en este entorno.",
    assistant_budget_exceeded: "Se alcanzó el límite de uso de IA configurado para Demi.",
    prompt_version_not_found: "No se encontró esta versión.",
    request_failed: "No se pudo completar. Conservamos tu borrador; vuelve a intentarlo.",
    assistant_busy: "Demi está respondiendo. Espera antes de enviar otro mensaje.",
  };
  return messages[code] ?? messages.request_failed;
}
