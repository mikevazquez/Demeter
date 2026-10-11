"use client";

import { X } from "@phosphor-icons/react";
import { useEffect, useId, useRef, type ReactNode } from "react";

export default function PortalSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const items = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex='0']",
        ) ?? [],
      ).filter((el) => el.getClientRects().length > 0);
    items()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab") return;
      const all = items(),
        first = all[0],
        last = all.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
      if (previous?.isConnected) previous.focus();
    };
  }, [onClose]);
  return (
    <div
      className="portal-sheet-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className="portal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panel}
      >
        <div className="portal-sheet-grab" aria-hidden="true" />
        <header>
          <h2 id={titleId}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar">
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
