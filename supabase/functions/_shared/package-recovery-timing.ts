export type PackageRecoveryTiming = {
  scheduledFor: string;
  expiresAt: string;
  suppressed: boolean;
  reasonCode: string | null;
};

function addCalendarDays(dateText: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!match) return null;
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  value.setUTCDate(value.getUTCDate() + days);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function localDateTimeToUtc(dateText: string, timezone: string, hour: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!match) return null;
  const desiredLocal = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour);
  let candidate = desiredLocal;

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = Object.fromEntries(
        formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]),
      );
      const representedLocal = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second),
      );
      candidate += desiredLocal - representedLocal;
    }

    return new Date(candidate);
  } catch {
    return null;
  }
}

export function packageRecoveryTiming(input: {
  expiresOn: string | null;
  daysAfter: number | null;
  timezone: string;
  now?: Date;
}): PackageRecoveryTiming {
  if (
    !input.expiresOn ||
    input.daysAfter === null ||
    !Number.isInteger(input.daysAfter) ||
    input.daysAfter < 1 ||
    input.daysAfter > 180
  ) {
    throw new Error("after_event_config_invalid");
  }

  const targetDate = addCalendarDays(input.expiresOn, input.daysAfter);
  const target = targetDate ? localDateTimeToUtc(targetDate, input.timezone, 10) : null;
  if (!target || !Number.isFinite(target.getTime())) {
    throw new Error("package_expiry_date_invalid");
  }

  const expiresAt = new Date(target.getTime() + 3 * 24 * 60 * 60 * 1000);
  const now = input.now ?? new Date();
  if (now >= expiresAt) {
    return {
      scheduledFor: target.toISOString(),
      expiresAt: expiresAt.toISOString(),
      suppressed: true,
      reasonCode: "delivery_window_elapsed",
    };
  }

  return {
    scheduledFor: (target <= now ? now : target).toISOString(),
    expiresAt: expiresAt.toISOString(),
    suppressed: false,
    reasonCode: null,
  };
}
