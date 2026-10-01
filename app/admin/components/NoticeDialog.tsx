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

const toneClasses: Record<NoticeTone, { icon: string; eyebrow: string; symbol: string }> = {
  success: {
    icon: "is-success",
    eyebrow: "",
    symbol: "✓",
  },
  warning: {
    icon: "is-warning",
    eyebrow: "is-warning",
    symbol: "!",
  },
  error: {
    icon: "is-error",
    eyebrow: "is-error",
    symbol: "!",
  },
  info: {
    icon: "is-info",
    eyebrow: "is-info",
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
      className="sf-admin-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="studio-flow-notice-title"
    >
      <div className="sf-admin-dialog">
        <div className="sf-admin-dialog-body">
          <div className={`sf-admin-dialog-icon ${classes.icon}`} aria-hidden="true">
            {classes.symbol}
          </div>

          <p className={`sf-admin-dialog-eyebrow ${classes.eyebrow}`}>{eyebrow}</p>

          <h2 id="studio-flow-notice-title" className="sf-admin-dialog-title">
            {title}
          </h2>

          <div className="sf-admin-dialog-copy">{children}</div>

          <button type="button" className="sf-admin-dialog-action" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
