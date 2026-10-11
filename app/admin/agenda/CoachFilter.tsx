"use client";

import { useRouter, useSearchParams } from "next/navigation";

export default function CoachFilter({
  coaches,
  value,
}: {
  coaches: { id: string; name: string }[];
  value: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <label className="portal-coach-filter">
      <span className="sr-only">Coach</span>
      <select
        aria-label="Coach"
        value={value}
        onChange={(event) => {
          const next = new URLSearchParams(params.toString());
          if (event.target.value) next.set("coach", event.target.value);
          else next.delete("coach");
          next.delete("session");
          router.push(`/admin/agenda?${next}`);
        }}
      >
        <option value="">Todos los coaches</option>
        {coaches.map((coach) => (
          <option key={coach.id} value={coach.id}>
            {coach.name}
          </option>
        ))}
      </select>
    </label>
  );
}
