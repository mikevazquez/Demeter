"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";

import LoadingSpinner from "./LoadingSpinner";

type PendingActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  pendingLabel?: string;
};

export default function PendingActionButton({
  children,
  pendingLabel = "Procesando…",
  className,
  disabled,
  ...props
}: PendingActionButtonProps) {
  const { pending } = useFormStatus();
  const isDisabled = Boolean(disabled || pending);

  return (
    <button
      {...props}
      type={props.type ?? "submit"}
      className={className}
      disabled={isDisabled}
      aria-busy={pending}
    >
      {pending ? (
        <span className="inline-flex items-center justify-center gap-2">
          <LoadingSpinner />
          <span>{pendingLabel}</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
