"use client";

import { useState } from "react";

type InfoKind = "activeDays" | "noShow" | "continuity" | "renewal";

const copy: Record<InfoKind, { title: string; body: string }> = {
  activeDays: {
    title: "Días activos",
    body:
      "Son los días distintos en los que asististe al estudio. Si tomas varias clases el mismo día, ese día cuenta una sola vez para tu Medalla.",
  },
  noShow: {
    title: "No show",
    body:
      "Cada clase que reservas y no registras como asistida cuenta como un no show. Si tienes varias reservas el mismo día, cada una se evalúa por separado.",
  },
  continuity: {
    title: "Continuidad",
    body:
      "Es el tiempo que llevas asistiendo de manera continua para Medallas. Si pasan 30 días consecutivos sin ninguna asistencia, tu continuidad vuelve a comenzar desde cero. Tu antigüedad histórica como alumna no se pierde.",
  },
  renewal: {
    title: "Renovación",
    body:
      "Mide cuántos días pasan entre el vencimiento de tu paquete anterior y tu siguiente renovación. Mientras menos tiempo pase, mayor puede ser la Medalla que obtengas.",
  },
};

export default function MedalInfoDialog({
  kind,
  label = "¿Qué significa?",
}: {
  kind: InfoKind;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const item = copy[kind];

  return (
    <>
      <button
        type="button"
        aria-label={`Qué significa ${item.title}`}
        onClick={() => setOpen(true)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/20 text-[10px] font-semibold text-zinc-400 transition hover:border-fuchsia-400/50 hover:text-fuchsia-300"
      >
        i
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={item.title}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-3 backdrop-blur-sm sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-[28px] border border-fuchsia-500/30 bg-[#09111d] p-5 shadow-[0_0_45px_rgba(236,72,153,0.16)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
                  {label}
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-white">{item.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-lg text-zinc-400 transition hover:text-white"
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>
            <p className="mt-4 text-sm leading-6 text-zinc-300">{item.body}</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-6 min-h-12 w-full rounded-2xl bg-fuchsia-600 px-4 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
            >
              Entendido
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
