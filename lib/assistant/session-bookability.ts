export const MINUTE_MS = 60_000;

export function currentMinuteStart(now = Date.now()) {
  return Math.floor(now / MINUTE_MS) * MINUTE_MS;
}

export function isSessionStartCurrentOrFutureMinute(startsAt: string, now = Date.now()) {
  const startsAtMs = new Date(startsAt).getTime();
  if (!Number.isFinite(startsAtMs)) return false;
  return startsAtMs >= currentMinuteStart(now);
}

export function isSessionBookableNow(
  session: { status: string; starts_at: string },
  now = Date.now(),
) {
  return (
    session.status === "scheduled" &&
    isSessionStartCurrentOrFutureMinute(session.starts_at, now)
  );
}
