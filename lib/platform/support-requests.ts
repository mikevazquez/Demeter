// NEB-01-19 · Solicitudes de soporte (migración 20261023163000_neb01_support_requests).

export type SupportRequest = {
  id: string;
  studioId: string | null;
  studioName: string | null;
  subject: string;
  body: string;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
  response: string | null;
};

export function parseSupportRequests(raw: unknown): SupportRequest[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const data = (item ?? {}) as Record<string, unknown>;
    return {
      id: String(data.id ?? ""),
      studioId: typeof data.studio_id === "string" ? data.studio_id : null,
      studioName: typeof data.studio_name === "string" ? data.studio_name : null,
      subject: String(data.subject ?? ""),
      body: String(data.body ?? ""),
      status: data.status === "resolved" ? "resolved" : "open",
      createdAt: String(data.created_at ?? ""),
      resolvedAt: typeof data.resolved_at === "string" ? data.resolved_at : null,
      response: typeof data.response === "string" ? data.response : null,
    };
  });
}

export const SUPPORT_REQUEST_ERRORS: Record<string, string> = {
  forbidden: "Tu cuenta no puede pedir ayuda para este estudio.",
  support_subject_invalid: "Escribe un asunto de 3 a 120 caracteres.",
  support_body_too_long: "El detalle puede tener hasta 2,000 caracteres.",
  support_too_many_open: "Ya tienes 10 solicitudes abiertas. Espera respuesta antes de enviar otra.",
  support_request_not_found: "Esa solicitud ya no existe.",
};

export function supportRequestErrorCode(message: string | null | undefined) {
  if (!message) return "error";
  return Object.keys(SUPPORT_REQUEST_ERRORS).find((code) => message.includes(code)) ?? "error";
}
