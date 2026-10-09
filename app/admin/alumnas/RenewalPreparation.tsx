"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export default function RenewalPreparation({
  studentId,
  name,
  packageName,
  expires,
  credits,
  price,
  canSell,
  channel,
}: {
  studentId: string;
  name: string;
  packageName: string;
  expires: string;
  credits: string;
  price: string | null;
  canSell: boolean;
  channel: string;
}) {
  const [mode, setMode] = useState<"renewal" | "message" | null>(null);
  const [message, setMessage] = useState(
    `¡Hola, ${name.split(" ")[0]}! Vi que tu paquete ${packageName} vence ${expires} y tienes ${credits}. ¿Te gustaría que revisemos las opciones para renovarlo y continuar con tus clases?`,
  );
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!mode) return;
    trigger.current = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      trigger.current?.focus();
    };
  }, [mode]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <>
      <div className="crm-actions">
        {canSell ? (
          <button className="crm-btn is-primary" type="button" onClick={() => setMode("renewal")}>
            Preparar renovación
          </button>
        ) : null}
        <button className="crm-btn" type="button" onClick={() => setMode("message")}>
          Ver mensaje sugerido
        </button>
      </div>
      {mode ? (
        <dialog
          ref={dialog}
          className={`crm-dialog${mode === "message" ? " is-compose" : ""}`}
          aria-labelledby="crm-renewal-title"
          onCancel={() => setMode(null)}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              const rect = event.currentTarget.getBoundingClientRect();
              if (
                event.clientX < rect.left ||
                event.clientX > rect.right ||
                event.clientY < rect.top ||
                event.clientY > rect.bottom
              )
                setMode(null);
            }
          }}
        >
          <header className="crm-modal-top">
            <h2 id="crm-renewal-title">
              {mode === "renewal" ? "Preparar renovación" : "Revisa el mensaje"}
            </h2>
            <button
              type="button"
              className="crm-close"
              aria-label="Cerrar"
              onClick={() => setMode(null)}
            >
              ×
            </button>
          </header>
          {mode === "renewal" ? (
            <>
              <p className="crm-meta">
                Revisa el paquete actual antes de registrar una nueva venta.
              </p>
              <div className="crm-info">
                <span>Paquete</span>
                <strong>{packageName}</strong>
              </div>
              {price ? (
                <div className="crm-info">
                  <span>Precio de catálogo actual</span>
                  <strong>{price}</strong>
                </div>
              ) : null}
              <div className="crm-info">
                <span>Vigencia actual</span>
                <strong>{expires}</strong>
              </div>
              <div className="crm-info">
                <span>Disponibles</span>
                <strong>{credits}</strong>
              </div>
              <div className="crm-actions">
                <Link
                  className="crm-btn is-primary"
                  href={`/admin/ventas/nueva?student_id=${studentId}`}
                >
                  Registrar renovación
                </Link>
                <button className="crm-btn" type="button" onClick={() => setMode("message")}>
                  Revisar mensaje
                </button>
              </div>
            </>
          ) : (
            <div className="crm-compose-grid">
              <div>
                <p className="crm-why">
                  Tu paquete vence {expires}. Revisa y ajusta el borrador antes de compartirlo.
                </p>
                <p className="crm-meta">
                  Canal: {channel === "Sin conversación" ? "Por confirmar con la alumna" : channel}
                </p>
                <label className="crm-field">
                  Mensaje
                  <textarea
                    value={message}
                    rows={6}
                    onChange={(event) => {
                      setMessage(event.target.value);
                      setCopied(false);
                    }}
                  />
                </label>
                <p className="crm-meta">
                  Este borrador no se envía ni se registra como un mensaje enviado.
                </p>
                <div className="crm-actions">
                  <button className="crm-btn" type="button" onClick={() => setMode(null)}>
                    Volver a la ficha
                  </button>
                  <button
                    className="crm-btn is-primary"
                    type="button"
                    onClick={copy}
                    disabled={!message.trim()}
                  >
                    Copiar mensaje
                  </button>
                </div>
                <p className="crm-meta" role="status">
                  {copied
                    ? "Mensaje copiado."
                    : copyError
                      ? "No pudimos copiarlo. Selecciona el texto para copiarlo manualmente."
                      : ""}
                </p>
              </div>
              <aside className="crm-preview">
                <h3>Vista previa · {name.split(" ")[0]}</h3>
                <div className="crm-preview-bubble">{message}</div>
              </aside>
            </div>
          )}
        </dialog>
      ) : null}
    </>
  );
}
