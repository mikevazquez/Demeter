"use client";

import { useState } from "react";

export default function BirthdayRecipientFields({
  initialRecipient,
  selfAllowed,
  friendAllowed,
}: {
  initialRecipient: "self" | "friend";
  selfAllowed: boolean;
  friendAllowed: boolean;
}) {
  const [recipient, setRecipient] = useState<"self" | "friend">(
    !selfAllowed && friendAllowed ? "friend" : !friendAllowed ? "self" : initialRecipient,
  );

  const option = (value: "self" | "friend", label: string, hint: string, enabled: boolean) => (
    <label
      className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl border p-3 transition ${
        recipient === value
          ? "border-[#f6d67a]/60 bg-[#f6d67a]/[0.08]"
          : "border-white/10 bg-black/15"
      } ${enabled ? "" : "cursor-not-allowed opacity-50"}`}
    >
      <input
        type="radio"
        name="recipient"
        value={value}
        checked={recipient === value}
        disabled={!enabled}
        onChange={() => setRecipient(value)}
        className="mt-1 h-4 w-4 accent-[#f6d67a]"
      />
      <span>
        <span className="block text-sm font-semibold text-white">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-zinc-400">{hint}</span>
      </span>
    </label>
  );

  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-xs font-semibold text-zinc-300">¿Para quién es el pase?</legend>
      {option(
        "self",
        "Para mí",
        selfAllowed ? "Reservas tu lugar sin usar créditos." : "Ya tienes esta clase reservada.",
        selfAllowed,
      )}
      {friendAllowed
        ? option("friend", "Para una amiga", "Le guardamos un lugar a tu invitada.", true)
        : null}
      {recipient === "friend" ? (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-black/15 p-3">
          <label className="block">
            <span className="text-[11px] font-semibold text-zinc-300">Nombre de tu amiga</span>
            <input
              name="friend_name"
              required
              maxLength={120}
              autoComplete="off"
              className="mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-[#f6d67a]/60"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-zinc-300">Su WhatsApp</span>
            <input
              name="friend_phone"
              required
              inputMode="tel"
              placeholder="10 dígitos"
              autoComplete="off"
              className="mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-[#f6d67a]/60"
            />
          </label>
          <p className="text-[11px] leading-4 text-zinc-500">
            Lo usamos solo para registrar su visita en el estudio.
          </p>
        </div>
      ) : null}
    </fieldset>
  );
}
