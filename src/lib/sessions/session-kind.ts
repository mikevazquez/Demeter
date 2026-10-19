export type SessionKind = "class" | "workshop" | "event" | "masterclass";

export function resolveSessionKind(input: {
  workshopOfferId?: string | null;
  programKind?: string | null;
}): SessionKind {
  if (input.workshopOfferId) return "workshop";
  if (input.programKind === "event") return "event";
  if (input.programKind === "masterclass") return "masterclass";
  if (input.programKind === "workshop") return "workshop";
  return "class";
}

export function sessionKindLabel(kind: SessionKind) {
  if (kind === "workshop") return "Taller";
  if (kind === "event") return "Evento";
  if (kind === "masterclass") return "Masterclass";
  return "Clase";
}
