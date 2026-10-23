export const BIRTHDAY_META_TEMPLATE_NAME = "demeter_cumpleanos";
export const BIRTHDAY_META_BODY =
  "¡Feliz cumpleaños, {{1}}! En {{2}} celebramos contigo y te deseamos un día lleno de alegría. Gracias por ser parte de nuestra comunidad.";

// CUMP-01-10 · Aviso del día 1 de su mes: el regalo ya está en su portal.
export const BIRTHDAY_MONTH_META_TEMPLATE_NAME = "mes_cumpleanos_regalo";
export const BIRTHDAY_MONTH_META_BODY =
  "¡{{1}}, este mes te festejamos en {{2}}! Tienes 1 pase de clase de regalo para usar antes de que termine tu mes. Encuéntralo en tu portal.";

function fill(body: string, name: string, studio: string) {
  return body.replace("{{1}}", () => name).replace("{{2}}", () => studio);
}

export function birthdayMessage(name: string, studio: string) {
  return fill(BIRTHDAY_META_BODY, name, studio);
}

export function birthdayMonthMessage(name: string, studio: string) {
  return fill(BIRTHDAY_MONTH_META_BODY, name, studio);
}
