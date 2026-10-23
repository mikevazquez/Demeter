export const BIRTHDAY_META_TEMPLATE_NAME = "demeter_cumpleanos";
export const BIRTHDAY_META_BODY =
  "¡Feliz cumpleaños, {{1}}! En {{2}} celebramos contigo y te deseamos un día lleno de alegría. Gracias por ser parte de nuestra comunidad.";

export function birthdayMessage(name: string, studio: string) {
  return BIRTHDAY_META_BODY.replace("{{1}}", () => name).replace("{{2}}", () => studio);
}
