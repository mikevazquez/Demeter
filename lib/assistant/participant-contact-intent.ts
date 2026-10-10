export function hasExplicitSharedParticipantPhone(value: string) {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const match = normalized.match(
    /(?:ambas|ambos|las dos|los dos|dos participantes)[^.?!]{0,45}(?:comparten|usan|tienen)[^.?!]{0,20}(?:mismo|un solo)[^.?!]{0,20}(?:celular|telefono|numero)/,
  );
  return Boolean(match && !/\bno\s+(?:comparten|usan|tienen)\b/.test(match[0]));
}
