"use client";

import { useRouter } from "next/navigation";

export default function TodayDateJump({
  selected,
  min,
  max,
}: {
  selected: string;
  min?: string | null;
  max?: string | null;
}) {
  const router = useRouter();
  return (
    <form action="/admin" method="get">
      <label htmlFor="today-date">Ir a fecha</label>
      <input
        id="today-date"
        name="date"
        type="date"
        defaultValue={selected}
        key={selected}
        min={min ?? undefined}
        max={max ?? undefined}
        aria-label="Ir a una fecha"
        onChange={(event) => {
          if (event.currentTarget.value && event.currentTarget.validity.valid) {
            router.push(`/admin?date=${event.currentTarget.value}`);
          }
        }}
      />
      <noscript>
        <button>Ir</button>
      </noscript>
    </form>
  );
}
