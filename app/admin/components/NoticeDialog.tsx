"use client";

import type { ReactNode } from "react";

type NoticeTone = "success" | "warning" | "error" | "info";

type NoticeDialogProps = {
  eyebrow: string;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  tone?: NoticeTone;
  onConfirm: () => void;
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

export default function NoticeDialog({
  eyebrow,
  title,
  children,
  confirmLabel = "Aceptar",
  tone = "success",
  onConfirm,
}: NoticeDialogProps) {
  const classes = toneClasses[tone];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="studio-flow-notice-title"
    >
      <div className={`w-full max-w-md rounded-3xl border p-6 shadow-2xl ${classes.card}`}>
        <div
          className={`mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border text-xl font-bold ${classes.icon}`}
          aria-hidden="true"
        >
          {classes.symbol}
        </div>

        <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${classes.eyebrow}`}>
          {eyebrow}
        </p>

        <h2 id="studio-flow-notice-title" className="mt-2 text-2xl font-semibold text-white">
          {title}
        </h2>

        <div className="mt-3 text-sm leading-6 text-zinc-300">{children}</div>

        <button type="button" className="primary-button mt-6 w-full" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
