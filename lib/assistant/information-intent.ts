// A question does not authorize preparing another charge. Mixed messages that
// explicitly request payment or booking still follow the normal tool flow.
export function isInformationOnlyRequest(message: string): boolean {
  const text = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const question =
    /informacion|\bdudas?\b|\bubicacion\b|\bdireccion\b|\brequisitos\b|\bque (incluye|necesito|llevo)\b|\bcomo (es|son|funciona)\b|\bprecios?\b|\bcostos?\b|\bcuanto cuesta\b/.test(
      text,
    );
  const action =
    /\b(quiero|puedes|podrias|voy a|necesito|ayudame a)\s+(?:que\s+)?(?:me\s+)?(?:reservar|reserves|agendar|agendes|pagar|cobrar|cobres|preparar|prepares)\b|\b(reservame|agendame|cobrame)\b|\b(datos|enlace|liga)\s+(?:para|de)\s+(?:pagar|pago|transferencia|transferir)\b/.test(
      text,
    );
  return question && !action;
}

export function shouldBlockPaymentForInformation(tool: string, message: string): boolean {
  return (
    [
      "prepare_first_class_payment",
      "prepare_group_booking",
      "prepare_booking",
      "prepare_bank_transfer_purchase",
      "prepare_transfer_package_choice",
      "execute_booking",
    ].includes(tool) && isInformationOnlyRequest(message)
  );
}
