"use client";
import { useRouter, useSearchParams } from "next/navigation";
export default function DisciplineFilter({
  value,
  options,
}: {
  value: string;
  options: { id: string; name: string }[];
}) {
  const router = useRouter();
  const query = useSearchParams();
  return (
    <label>
      Disciplina
      <select
        name="discipline"
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(query.toString());
          if (e.target.value) next.set("discipline", e.target.value);
          else next.delete("discipline");
          router.push(`/admin/inteligencia?${next}`);
        }}
      >
        <option value="">Todas</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
