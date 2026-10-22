// AUTH-REC-01 · Pure helpers for password recovery (no I/O, safe to unit test).
export type RecoveryPortal = "student" | "studio";

export type PasswordRuleState = {
  length: boolean;
  lettersAndNumbers: boolean;
  matches: boolean;
};

export const RECOVERY_LINK_TTL_MINUTES = 60;
export const RECOVERY_RESEND_SECONDS = 60;

export function passwordRuleState(password: string, confirmation: string): PasswordRuleState {
  return {
    length: password.length >= 8,
    lettersAndNumbers: /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(password) && /[0-9]/.test(password),
    matches: password.length > 0 && password === confirmation,
  };
}

export function newPasswordError(password: string, confirmation: string) {
  const state = passwordRuleState(password, confirmation);
  if (!state.length || !state.lettersAndNumbers) return "weak" as const;
  if (!state.matches) return "mismatch" as const;
  return null;
}

export function phoneTail(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 2 ? digits.slice(-2) : null;
}

export function maskEmail(email: string) {
  const [local, domain] = email.trim().toLowerCase().split("@");
  if (!local || !domain) return null;
  return `${local.slice(0, 1)}•••@${domain}`;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export type RecoveryTemplateShape = {
  bodyVariableCount: number;
  urlButtonIndex: number | null;
  urlButtonTemplate: string | null;
};

// Reads the approved Meta template definition. The recovery link can only travel in a URL
// button with a dynamic suffix ({{1}} at the end of its URL).
export function recoveryTemplateShape(components: unknown): RecoveryTemplateShape {
  const list = Array.isArray(components) ? components : [];
  let bodyVariableCount = 0;
  let urlButtonIndex: number | null = null;
  let urlButtonTemplate: string | null = null;

  for (const component of list) {
    if (!isObject(component)) continue;
    const type = String(component.type ?? "").toUpperCase();

    if (type === "BODY" && typeof component.text === "string") {
      const matches = component.text.match(/\{\{\s*[^}]+\s*\}\}/g) ?? [];
      bodyVariableCount = new Set(matches.map((match) => match.replace(/\s/g, ""))).size;
    }

    if (type === "BUTTONS" && Array.isArray(component.buttons)) {
      component.buttons.forEach((button, index) => {
        if (urlButtonIndex !== null || !isObject(button)) return;
        const url = typeof button.url === "string" ? button.url : "";
        if (String(button.type ?? "").toUpperCase() === "URL" && /\{\{\s*1\s*\}\}$/.test(url)) {
          urlButtonIndex = index;
          urlButtonTemplate = url;
        }
      });
    }
  }

  return { bodyVariableCount, urlButtonIndex, urlButtonTemplate };
}

// The suffix that, appended to the template's fixed URL prefix, rebuilds the desired link.
export function dynamicUrlSuffix(templateUrl: string, desiredUrl: string) {
  const prefix = templateUrl.replace(/\{\{\s*1\s*\}\}$/, "");
  if (!prefix || prefix === templateUrl) return null;
  if (!desiredUrl.startsWith(prefix)) return null;
  const suffix = desiredUrl.slice(prefix.length);
  return suffix.length > 0 && suffix.length <= 2000 ? suffix : null;
}

// Supabase access tokens carry the authentication methods used (amr). A password may only be
// set without the old one when the session came from a recovery link.
export function sessionCameFromRecovery(accessToken: string, nowSeconds: number) {
  const [, payload] = accessToken.split(".");
  if (!payload) return false;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (!isObject(claims) || !Array.isArray(claims.amr)) return false;

    return claims.amr.some(
      (entry) =>
        isObject(entry) &&
        entry.method === "recovery" &&
        typeof entry.timestamp === "number" &&
        nowSeconds - entry.timestamp <= RECOVERY_LINK_TTL_MINUTES * 60,
    );
  } catch {
    return false;
  }
}

export function parseRecoveryHash(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const errorCode = params.get("error_code") ?? params.get("error");
  if (errorCode) return { kind: "error" as const, errorCode };

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken && params.get("type") === "recovery") {
    return { kind: "session" as const, accessToken, refreshToken };
  }

  return { kind: "none" as const };
}
