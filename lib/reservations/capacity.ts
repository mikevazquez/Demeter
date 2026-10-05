const SEAT_OCCUPYING_RESERVATION_STATUSES = new Set(["reserved", "attended", "no_show"]);

export function isSeatOccupyingReservation(status: string): boolean {
  return SEAT_OCCUPYING_RESERVATION_STATUSES.has(status);
}

export function countSeatOccupyingReservations(statuses: readonly string[]): number {
  return statuses.filter(isSeatOccupyingReservation).length;
}
