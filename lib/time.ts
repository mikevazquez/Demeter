export function agendaLookbackIso(hours = 12) {
  const date = new Date();
  date.setHours(date.getHours() - hours);
  return date.toISOString();
}
