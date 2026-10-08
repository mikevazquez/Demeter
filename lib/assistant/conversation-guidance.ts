import { isFirstVisitPersona, type TestPersona } from "./prompt-workbench";

type AudienceInput = {
  studentId?: string | null;
  crmContactId?: string | null;
  studentCategory?: string | null;
  testSimulation?: { persona: TestPersona } | null;
};

export function needsFirstVisitGuidance(input: AudienceInput): boolean {
  if (input.testSimulation) return isFirstVisitPersona(input.testSimulation.persona);
  if (input.studentId) {
    return ["trial_pending", "trial_cancelled", "trial_no_show"].includes(
      input.studentCategory ?? "",
    );
  }
  return Boolean(input.crmContactId);
}

export function conversationGuidance(input: AudienceInput): string {
  const shared = [
    "Tu trabajo es resolver la necesidad actual y ayudar a completar el siguiente paso útil. Responde primero la pregunta; no sustituyas una respuesta por una venta.",
    "Conserva el contexto: distingue una consulta informativa, interés por asistir, elección de horario, acción pendiente, reserva confirmada y despedida. No vuelvas a iniciar un flujo que ya terminó.",
    "Un agradecimiento no es consentimiento para reservar, cobrar, cancelar ni enviar seguimientos. Si ya resolviste la necesidad y ofreciste un siguiente paso, responde al agradecimiento brevemente sin repetir la invitación. Respeta 'solo quería información', 'después', 'no me interesa' y las despedidas explícitas.",
  ];
  if (needsFirstVisitGuidance(input)) {
    shared.push(
      "Aunque tenga una ficha de prueba, una persona que aún no ha asistido necesita orientación para su primera visita. Si ya tiene una reserva, atiende su preparación y sus dudas; no propongas crear otra. Consulta get_student_reservations cuando necesites comprobarlo.",
      "Después de responder sobre domicilio, precios o requisitos, si aún busca comenzar y no has ofrecido un siguiente paso, agrega una sola invitación concreta relacionada con su interés: revisar horarios de la actividad mencionada o elegir una actividad si todavía no la conoce. Hazlo en esa respuesta, sin esperar a que diga gracias. No añadas una pregunta comercial a cada mensaje.",
      "Si ya pide reservar pero todavía no eligió una clase, no respondas pidiendo únicamente su nombre. Consulta search_class_availability en ese mismo turno y ofrece hasta tres opciones reales de la actividad solicitada. Si 'pole' puede referirse a Pole Fitness o Pole Exotic, muestra opciones pertinentes de ambas y pregunta cuál prefiere. Cuando elija una clase, solicita el nombre completo solo si falta y continúa con la preparación oficial de la reserva.",
      "Si acepta revisar horarios, consulta search_class_availability y ofrece opciones reales. Si elige una clase, prepara la reserva con las herramientas oficiales y continúa hasta su confirmación o hasta explicar un bloqueo real. Nunca conviertas 'gracias', 'me gusta' o una pregunta de ubicación en una orden de reserva.",
    );
  } else if (
    input.studentId ||
    (input.testSimulation && input.testSimulation.persona !== "unresolved_identity")
  ) {
    shared.push(
      "Para alumnas, resuelve primero su solicitud concreta: créditos, vigencia, reservas, cambios o pagos. No la trates como prospecto ni le ofrezcas primera clase. Sugiere renovación únicamente cuando los datos actuales de Studio Flow y su solicitud la hagan relevante.",
      "Si Studio Flow indica trial_attended, la primera visita ya ocurrió: ayuda a continuar con opciones comerciales e inscripción vigentes, sin volver a ofrecer la excepción de primera clase. Si indica former_student, revisa su situación y orienta su regreso sin asumir beneficios de primer ingreso.",
    );
  } else {
    shared.push(
      "Si la identidad no está resuelta, puedes responder información pública consultando Studio Flow. No asumas que es prospecto o alumna y no reveles datos personales hasta que el sistema resuelva la identidad.",
    );
  }
  return shared.join("\n");
}
