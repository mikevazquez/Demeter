export type FollowupRecommendation = {
  kind: "renewal" | "return";
  title: string;
  reason: string;
  facts: string[];
  message: string;
};

function daysBetween(from: string, to: string) {
  const fromTime = Date.parse(`${from}T12:00:00Z`);
  const toTime = Date.parse(`${to}T12:00:00Z`);
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) return null;
  return Math.floor((toTime - fromTime) / 86_400_000);
}

export function getFollowupRecommendation(input: {
  personType: "prospect" | "trial" | "student" | "former_student";
  today: string;
  name: string;
  currentPackage: {
    name: string;
    unlimited: boolean;
    availableCredits: number | null;
    creditLimit: number | null;
    expiresOn: string | null;
  } | null;
  lastAttendedOn: string | null;
  paused?: boolean;
}): FollowupRecommendation | null {
  if (input.paused) return null;

  const { currentPackage } = input;
  if (input.personType === "student" && currentPackage && !currentPackage.unlimited) {
    const daysToExpiry = currentPackage.expiresOn
      ? daysBetween(input.today, currentPackage.expiresOn)
      : null;
    const lowCredits =
      currentPackage.availableCredits !== null && currentPackage.availableCredits <= 2;
    const expiringSoon = daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= 7;

    if (lowCredits || expiringSoon) {
      const facts: string[] = [];
      if (currentPackage.availableCredits !== null && currentPackage.creditLimit !== null) {
        facts.push(
          `${currentPackage.availableCredits} de ${currentPackage.creditLimit} clases disponibles`,
        );
      }
      if (currentPackage.expiresOn && daysToExpiry !== null && daysToExpiry >= 0) {
        facts.push(
          daysToExpiry === 0
            ? "Vence hoy"
            : `Vence en ${daysToExpiry} ${daysToExpiry === 1 ? "día" : "días"}`,
        );
      }
      const reasons = [
        lowCredits ? "le quedan pocas clases" : "",
        expiringSoon ? "su paquete vence pronto" : "",
      ].filter(Boolean);
      const expiryCopy =
        currentPackage.expiresOn && daysToExpiry !== null && daysToExpiry >= 0
          ? new Intl.DateTimeFormat("es-MX", {
              day: "numeric",
              month: "long",
              timeZone: "UTC",
            }).format(new Date(`${currentPackage.expiresOn}T12:00:00Z`))
          : null;
      const creditsCopy =
        currentPackage.availableCredits !== null
          ? `Te quedan ${currentPackage.availableCredits} ${currentPackage.availableCredits === 1 ? "clase" : "clases"}`
          : "Tu paquete está por terminar";
      return {
        kind: "renewal",
        title: "Preparar renovación del paquete",
        reason: `${input.name}: ${reasons.join(" y ")}. Revisa la vigencia y el paquete antes de contactarla.`,
        facts,
        message: `¡Hola, ${input.name}! 💜 ${creditsCopy}${expiryCopy ? ` y tu paquete vence el ${expiryCopy}` : " de tu paquete"}. Si quieres, te comparto las opciones para renovarlo y que sigas reservando tus clases.`,
      };
    }
  }

  if (input.personType === "former_student" && !currentPackage && input.lastAttendedOn) {
    const inactiveDays = daysBetween(input.lastAttendedOn, input.today);
    if (inactiveDays !== null && inactiveDays >= 30) {
      return {
        kind: "return",
        title: "Invitarla a retomar el contacto",
        reason: `No hay una asistencia registrada desde hace ${inactiveDays} días. Puedes invitarla a una clase o actividad próxima del estudio.`,
        facts: [`Última asistencia: hace ${inactiveDays} días`, "Sin paquete activo"],
        message: `¡Hola, ${input.name}! 💜 Hace tiempo que no te vemos por el estudio y queríamos saludarte. Si te gustaría volver, puedo compartirte las próximas clases o actividades.`,
      };
    }
  }

  return null;
}
