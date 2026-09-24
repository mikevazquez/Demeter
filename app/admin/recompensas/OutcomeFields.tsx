"use client";

import { useState } from "react";

export function OutcomeFields({
  medalAllowed = true,
  medalRequired = false,
  defaultMedal = false,
  defaultReward = false,
  defaultRewardKind = "credits",
  defaultRewardValue = 1,
  defaultValidityDays = 30,
  defaultRewardVisibility = "visible",
  defaultRewardLabel = "",
  defaultBadgeTitle = "",
}: {
  medalAllowed?: boolean;
  medalRequired?: boolean;
  defaultMedal?: boolean;
  defaultReward?: boolean;
  defaultRewardKind?: string;
  defaultRewardValue?: number;
  defaultValidityDays?: number;
  defaultRewardVisibility?: string;
  defaultRewardLabel?: string;
  defaultBadgeTitle?: string;
}) {
  const [medal, setMedal] = useState(medalRequired || defaultMedal);
  const [reward, setReward] = useState(defaultReward);

  return (
    <div className="grid gap-4">
      {medalAllowed ? (
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <label className="flex items-center gap-3 text-sm font-semibold text-white">
            <input
              type="checkbox"
              name="badge_enabled"
              value="true"
              checked={medal}
              disabled={medalRequired}
              onChange={(event) => setMedal(event.target.checked)}
            />
            Otorgar logro / medalla
          </label>
          {medalRequired ? <input type="hidden" name="badge_enabled" value="true" /> : null}
          {medal ? (
            <label className="mt-3 grid gap-1 text-sm text-zinc-300">
              Nombre del logro
              <input
                name="badge_title"
                required
                defaultValue={defaultBadgeTitle}
                placeholder="Ej. Constancia de acero"
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
              />
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <label className="flex items-center gap-3 text-sm font-semibold text-white">
          <input
            type="checkbox"
            name="reward_enabled"
            value="true"
            checked={reward}
            onChange={(event) => setReward(event.target.checked)}
          />
          Otorgar recompensa
        </label>

        {reward ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm text-zinc-300">
              Tipo
              <select
                name="reward_kind"
                defaultValue={defaultRewardKind}
                className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
              >
                <option value="credits">Créditos de clase</option>
                <option value="percentage_discount">Descuento porcentual</option>
                <option value="fixed_discount">Descuento fijo</option>
                <option value="validity_extension">Extensión de vigencia</option>
                <option value="package">Paquete de clases</option>
                <option value="cash">Dinero</option>
                <option value="custom_manual">Recompensa personalizada</option>
              </select>
            </label>

            <label className="grid gap-1 text-sm text-zinc-300">
              Valor
              <input
                type="number"
                name="reward_value"
                min="1"
                step="1"
                required
                defaultValue={defaultRewardValue}
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
              />
            </label>

            <label className="grid gap-1 text-sm text-zinc-300 md:col-span-2">
              Nombre / detalle de la recompensa
              <input
                name="reward_label"
                defaultValue={defaultRewardLabel}
                placeholder="Ej. Taller gratis, paquete de 8 clases o $500 MXN"
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
              />
            </label>

            <label className="grid gap-1 text-sm text-zinc-300">
              Vigencia de la recompensa
              <input
                type="number"
                name="validity_days"
                min="1"
                step="1"
                defaultValue={defaultValidityDays}
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
              />
            </label>

            <label className="grid gap-1 text-sm text-zinc-300">
              Visibilidad
              <select
                name="reward_visibility"
                defaultValue={defaultRewardVisibility}
                className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
              >
                <option value="visible">Visible</option>
                <option value="surprise">Recompensa sorpresa</option>
              </select>
            </label>
          </div>
        ) : null}
      </div>
    </div>
  );
}
