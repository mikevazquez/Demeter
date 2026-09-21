"use client";

import { useRef, useState, useTransition } from "react";

import { createSingleClassMercadoPagoOrderAction } from "@/app/student/actions";

const errorCopy: Record<string, string> = {
  checkout_failed: "No pudimos iniciar el pago. Intenta de nuevo.",
  invalid_request: "No pudimos identificar esta clase.",
  mercadopago_not_configured: "Mercado Pago todavía no está configurado para este ambiente.",
  single_class_product_not_available: "Esta clase suelta no está disponible para compra online.",
  single_class_price_missing: "Esta clase no tiene un precio de clase suelta configurado.",
  session_full: "La clase se llenó antes de iniciar el pago.",
  session_not_bookable: "Esta clase ya no admite compras.",
  request_key_reused_for_different_product: "No pudimos reutilizar este intento de compra.",
  checkout_context_failed: "No pudimos preparar este pago. Intenta nuevamente.",
  student_context_failed: "No pudimos validar tu perfil para el pago.",
  online_price_invalid: "Esta clase no tiene un precio válido para compra online.",
  mercadopago_unreachable: "No pudimos conectar con Mercado Pago. Intenta nuevamente.",
  mercadopago_order_failed: "Mercado Pago rechazó el inicio del pago. Intenta nuevamente.",
};

export default function PurchaseSingleClassButton({
  sessionId,
  priceLabel,
  regularPriceLabel,
  discountPct = 0,
  levelTitle = null,
}: {
  sessionId: string;
  priceLabel: string;
  regularPriceLabel?: string | null;
  discountPct?: number;
  levelTitle?: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestKeyRef = useRef<string | null>(null);

  function buy() {
    if (isPending) return;

    if (!requestKeyRef.current) requestKeyRef.current = crypto.randomUUID();
    const requestKey = requestKeyRef.current;
    setErrorMessage(null);

    startTransition(async () => {
      const result = await createSingleClassMercadoPagoOrderAction(sessionId, requestKey);
      if (!result.ok) {
        setErrorMessage(errorCopy[result.error] ?? errorCopy.checkout_failed);
        return;
      }

      window.location.assign(result.checkoutUrl);
    });
  }

  return (
    <div className="space-y-3">
      {discountPct > 0 && levelTitle && regularPriceLabel ? (
        <div className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.055] p-3 text-left">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-zinc-500">Precio regular</span>
            <span className="text-zinc-400 line-through">{regularPriceLabel}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-3 text-xs">
            <span className="font-medium text-fuchsia-300">Beneficio {levelTitle}</span>
            <span className="font-semibold text-fuchsia-200">-{discountPct}%</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-white/10 pt-2">
            <span className="text-xs font-semibold text-white">Total para ti</span>
            <strong className="text-base text-white">{priceLabel}</strong>
          </div>
        </div>
      ) : null}
      <button
        type="button"
        onClick={buy}
        disabled={isPending}
        className="min-h-11 rounded-2xl bg-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:cursor-wait disabled:opacity-60"
      >
        {isPending ? "Abriendo pago seguro…" : `Comprar · ${priceLabel}`}
      </button>
      {errorMessage ? <p className="mt-2 max-w-xs text-xs text-rose-300">{errorMessage}</p> : null}
    </div>
  );
}
