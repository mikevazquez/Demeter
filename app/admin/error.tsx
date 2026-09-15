"use client";

import { useEffect } from "react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="admin-route-state" role="alert">
      <section className="admin-state-card admin-state-error">
        <p className="admin-state-eyebrow">NO PUDIMOS CARGAR ESTA SECCIÓN</p>
        <h1>Algo salió mal</h1>
        <p>Tu información sigue segura. Intenta cargar esta sección nuevamente.</p>
        <button className="admin-state-action" type="button" onClick={reset}>
          Intentar de nuevo
        </button>
      </section>
    </main>
  );
}
