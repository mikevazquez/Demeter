export const MAX_PROMPT_LENGTH = 24_000;

export type PromptVersion = {
  id: string;
  kind: "baseline" | "draft" | "activation";
  instructions: string;
  note: string;
  created_at: string;
};

export type TestPersona = "prospect" | "student";

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
