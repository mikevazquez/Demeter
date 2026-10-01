"use client";

import type { ReactNode } from "react";

export default function AdminDialogFrame({
  eyebrow,
  title,
  tone = "warning",
  onClose,
  children,
  footer,
  labelledBy = "admin-confirm-dialog-title",
}: {
  eyebrow: string;
  title: string;
  tone?: "warning" | "danger" | "info";
  onClose?: () => void;
  children: ReactNode;
  footer: ReactNode;
  labelledBy?: string;
}) {
  const iconClass = tone === "danger" ? "is-error" : tone === "info" ? "is-info" : "is-warning";
  const eyebrowClass = iconClass;

  return (
    <div
      className="sf-admin-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <section className="sf-admin-dialog">
        <div className="sf-admin-dialog-body">
          <div className={`sf-admin-dialog-icon ${iconClass}`} aria-hidden="true">
            {tone === "danger" ? "!" : tone === "info" ? "i" : "!"}
          </div>
          <p className={`sf-admin-dialog-eyebrow ${eyebrowClass}`}>{eyebrow}</p>
          <h2 id={labelledBy} className="sf-admin-dialog-title">
            {title}
          </h2>
          <div className="sf-admin-dialog-copy">{children}</div>
          <div className="sf-admin-dialog-footer">{footer}</div>
        </div>
      </section>
    </div>
  );
}
