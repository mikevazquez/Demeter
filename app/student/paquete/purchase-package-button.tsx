"use client";

import { useRef, useState, useTransition } from "react";

import { createMercadoPagoOrderAction } from "@/app/student/actions";

const errorCopy: Record<string, string> = {
  checkout_failed: "No pudimos iniciar el pago. Intenta de nuevo.",
  invalid_request: "No pudimos identificar el paquete.",
  mercadopago_not_configured: "Mercado Pago todavía no está configurado para este ambiente.",
  product_not_available_online: "Este paquete ya no está disponible para compra online.",
  request_key_reused_for_different_product: "No pudimos reutilizar este intento de compra.",
  checkout_context_failed: "No pudimos preparar este pago. Intenta nuevamente.",
  student_context_failed: "No pudimos validar tu perfil para el pago.",
  online_price_invalid: "Este paquete no tiene un precio válido para compra online.",
  mercadopago_unreachable: "No pudimos conectar con Mercado Pago. Intenta nuevamente.",
  mercadopago_order_failed: "Mercado Pago rechazó el inicio del pago. Intenta nuevamente.",
};

type Props = {
  productTemplateId: string;
  productName: string;
  evaluationInvitationId?: string;
  evaluationSessionId?: string;
};

export function PurchasePackageButton({
  productTemplateId,
  productName,
  evaluationInvitationId,
  evaluationSessionId,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestKeyRef = useRef<string | null>(null);

  function buy() {
    if (isPending) return;

    if (!requestKeyRef.current) {
      requestKeyRef.current = crypto.randomUUID();
    }

    const requestKey = requestKeyRef.current;
    setErrorMessage(null);

    startTransition(async () => {
      const result =
        evaluationInvitationId && evaluationSessionId
          ? await createMercadoPagoOrderAction(productTemplateId, requestKey, {
              invitationId: evaluationInvitationId,
              sessionId: evaluationSessionId,
            })
          : await createMercadoPagoOrderAction(productTemplateId, requestKey);

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
        aria-label={`Comprar ${productName}`}
        className="min-h-11 rounded-2xl bg-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:cursor-wait disabled:opacity-60"
      >
        {isPending ? "Abriendo Mercado Pago…" : "Comprar"}
      </button>
      {errorMessage ? <p className="mt-2 max-w-xs text-xs text-rose-300">{errorMessage}</p> : null}
    </div>
  );
}
