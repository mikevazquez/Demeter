"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

type NoticeTone = "success" | "warning" | "error" | "info";

type StudentNoticeDialogProps = {
  eyebrow: string;
  title: string;
  children: ReactNode;
  dismissHref: string;
  confirmLabel?: string;
  tone?: NoticeTone;
};

const toneClasses: Record<
  NoticeTone,
  { card: string; icon: string; eyebrow: string; symbol: string }
> = {
  success: {
    card: "border-fuchsia-300/25 bg-[#160d16]",
    icon: "border-fuchsia-300/25 bg-fuchsia-400/10 text-fuchsia-200",
    eyebrow: "text-fuchsia-300",
    symbol: "✓",
  },
  warning: {
    card: "border-amber-300/25 bg-[#17130d]",
    icon: "border-amber-300/25 bg-amber-300/10 text-amber-200",
    eyebrow: "text-amber-200",
    symbol: "!",
  },
  error: {
    card: "border-rose-300/25 bg-[#190d11]",
    icon: "border-rose-300/25 bg-rose-400/10 text-rose-200",
    eyebrow: "text-rose-200",
    symbol: "!",
  },
  info: {
    card: "border-sky-300/25 bg-[#0d1419]",
    icon: "border-sky-300/25 bg-sky-400/10 text-sky-200",
    eyebrow: "text-sky-200",
    symbol: "i",
  },
};

export default function StudentNoticeDialog({
  eyebrow,
  title,
  children,
  dismissHref,
  confirmLabel = "Aceptar",
  tone = "success",
}: StudentNoticeDialogProps) {
  const router = useRouter();
  const classes = toneClasses[tone];

  function dismiss() {
    router.replace(dismissHref, { scroll: false });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 p-4 backdrop-blur-sm sm:items-center sm:p-5"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-notice-title"
        className={`w-full max-w-md rounded-3xl border p-6 shadow-2xl ${classes.card}`}
      >
        <div
          className={`mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border text-xl font-bold ${classes.icon}`}
          aria-hidden="true"
        >
          {classes.symbol}
        </div>

        <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${classes.eyebrow}`}>
          {eyebrow}
        </p>
        <h2 id="student-notice-title" className="mt-2 text-2xl font-semibold text-white">
          {title}
        </h2>
        <div className="mt-3 text-sm leading-6 text-zinc-300">{children}</div>

        <button
          type="button"
          className="mt-6 w-full rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
          onClick={dismiss}
        >
          {confirmLabel}
        </button>
      </section>
    </div>
  );
}
