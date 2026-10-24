/** P360-V2-ACC · Estados y textos del acceso automático; módulo puro. */
export const AUTO_ACCESS_STATUSES = [
  "sent",
  "pending_delivery",
  "already_linked",
  "failed",
] as const;
export type AutoAccessStatus = (typeof AUTO_ACCESS_STATUSES)[number];

export function isAutoAccessStatus(value: string): value is AutoAccessStatus {
  return (AUTO_ACCESS_STATUSES as readonly string[]).includes(value);
}

export type AutoAccessResult = {
  status: AutoAccessStatus;
  errorCode: string | null;
};

export type ProvisionResponse = {
  ok?: unknown;
  error?: unknown;
  activationLinkGenerated?: unknown;
  welcomeDelivery?: { status?: unknown; errorCode?: unknown } | null;
};

export function classifyAutoAccessResponse(
  data: ProvisionResponse | null,
  errorCode: string | null,
): AutoAccessResult {
  if (!data || data.ok !== true) {
    const code =
      errorCode ?? (typeof data?.error === "string" ? data.error : "provision_unavailable");
    if (code === "student_already_linked") return { status: "already_linked", errorCode: null };
    return { status: "failed", errorCode: code };
  }
  if (data.activationLinkGenerated === false) {
    return { status: "pending_delivery", errorCode: "activation_link_failed" };
  }
  const delivery = data.welcomeDelivery;
  if (delivery?.status === "accepted") return { status: "sent", errorCode: null };
  return {
    status: "pending_delivery",
    errorCode: typeof delivery?.errorCode === "string" ? delivery.errorCode : "delivery_unknown",
  };
}

export function autoAccessMessage(status: AutoAccessStatus) {
  switch (status) {
    case "sent":
      return "Su acceso a la app se envió por WhatsApp.";
    case "already_linked":
      return "Ya tenía acceso a la app.";
    case "pending_delivery":
      return "Su cuenta quedó lista, pero el WhatsApp con su acceso no salió; puedes reenviarlo desde su perfil.";
    default:
      return "No se pudo preparar su acceso a la app; puedes reintentarlo desde su perfil.";
  }
}

export function autoAccessNoticeClass(status: AutoAccessStatus) {
  return status === "sent" || status === "already_linked" ? "notice success" : "notice error";
}
