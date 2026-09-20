"use client";

import { useFormStatus } from "react-dom";

export function PendingSubmitButton({
  children,
  pendingLabel,
  className = "primary-button",
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button className={className} type="submit" disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
