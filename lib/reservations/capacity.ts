const SEAT_OCCUPYING_RESERVATION_STATUSES = new Set(["reserved", "attended", "no_show"]);
const BOOKED_RESERVATION_STATUSES = new Set(["reserved", "attended", "no_show"]);

export function isSeatOccupyingReservation(status: string): boolean {
  return SEAT_OCCUPYING_RESERVATION_STATUSES.has(status);
}

export function countSeatOccupyingReservations(statuses: readonly string[]): number {
  return statuses.filter(isSeatOccupyingReservation).length;
}

export function countBookedReservations(statuses: readonly string[]): number {
  return statuses.filter((status) => BOOKED_RESERVATION_STATUSES.has(status)).length;
}
