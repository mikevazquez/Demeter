"use client";

import { useRef, useState, useTransition } from "react";

import { createEnrollmentMercadoPagoOrderAction } from "@/app/student/actions";

const errorCopy: Record<string, string> = {
  checkout_failed: "No pudimos iniciar el pago de tu inscripción. Intenta de nuevo.",
  invalid_request: "No pudimos identificar la inscripción.",
  enrollment_already_active: "Tu inscripción ya está vigente.",
  enrollment_product_not_configured: "La inscripción no está configurada para compra.",
  mercadopago_not_configured: "Mercado Pago todavía no está configurado para este ambiente.",
  mercadopago_unreachable: "No pudimos conectar con Mercado Pago. Intenta nuevamente.",
  mercadopago_order_failed: "Mercado Pago rechazó el inicio del pago. Intenta nuevamente.",
};

export default function PurchaseEnrollmentButton({
  productTemplateId,
  label = "Pagar inscripción",
}: {
  productTemplateId: string;
  label?: string;
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
        disabled={isPending}
        onClick={buy}
        className="min-h-11 rounded-2xl bg-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:cursor-wait disabled:opacity-60"
      >
        {isPending ? "Abriendo pago seguro…" : label}
      </button>
      {errorMessage ? <p className="mt-2 text-xs text-rose-300">{errorMessage}</p> : null}
    </div>
  );
}
