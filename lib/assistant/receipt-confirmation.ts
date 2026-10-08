// Shared Demi copy: adapters must not turn a receipt into a settled payment.
export function trialReceiptConfirmation(activity: string, accessText = "") {
  return `Recibí tu comprobante y el monto coincide. Tu primera clase de ${activity} quedó reservada.${accessText} Tu transferencia está en proceso de validación por el equipo. La reserva puede cancelarse si la transferencia no se confirma correctamente; te avisaremos por este mismo chat.`;
}
