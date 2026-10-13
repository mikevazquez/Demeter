"use client";
import { useEffect, useState } from "react";
export default function StudioClock({
  serverNow,
  timeZone,
  locale,
  label,
}: {
  serverNow: string;
  timeZone: string;
  locale: string;
  label?: string;
}) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(
      () => setNow(new Date(new Date(serverNow).getTime() + Date.now() - started).toISOString()),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [serverNow]);
  return (
    <time dateTime={now} aria-label="Hora del estudio">
      {label ? `${label} · ` : null}
      {new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(
        new Date(now),
      )}
    </time>
  );
}
