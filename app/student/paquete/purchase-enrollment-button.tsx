"use client";

import { useRef, useState, useTransition } from "react";
import { createEnrollmentMercadoPagoOrderAction } from "@/app/student/actions";

const errorCopy: Record<string, string> = {
  checkout_failed: "No pudimos iniciar el pago. Intenta de nuevo.",
  invalid_request: "No pudimos identificar la inscripción.",
  mercadopago_not_configured: "Mercado Pago todavía no está configurado para este ambiente.",
  enrollment_already_active: "Tu inscripción ya está activa.",
  enrollment_product_not_configured: "La inscripción no está configurada correctamente.",
  product_not_available_online: "La inscripción ya no está disponible.",
  checkout_context_failed: "No pudimos preparar este pago. Intenta nuevamente.",
  student_context_failed: "No pudimos validar tu perfil para el pago.",
  online_price_invalid: "La inscripción no tiene un precio válido.",
};

export function PurchaseEnrollmentButton({
  productTemplateId,
  productName,
}: {
  productTemplateId: string;
  productName: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestKeyRef = useRef<string | null>(null);

  function buy() {
    if (isPending) return;
    if (!requestKeyRef.current) requestKeyRef.current = crypto.randomUUID();

    setErrorMessage(null);
    startTransition(async () => {
      const result = await createEnrollmentMercadoPagoOrderAction(
        productTemplateId,
        requestKeyRef.current!,
      );

      if (!result.ok) {
        setErrorMessage(errorCopy[result.error] ?? errorCopy.checkout_failed);
        return;
      }

      window.location.assign(result.checkoutUrl);
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={buy}
        disabled={isPending}
        className="min-h-11 rounded-2xl bg-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:cursor-wait disabled:opacity-60"
      >
        {isPending ? "Abriendo Mercado Pago…" : "Pagar inscripción"}
      </button>
      <span className="sr-only">{productName}</span>
      {errorMessage ? <p className="mt-2 text-xs text-rose-300">{errorMessage}</p> : null}
    </div>
  );
}
