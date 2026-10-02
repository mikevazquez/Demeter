"use client";

import { BrowserQRCodeReader } from "@zxing/browser";
import { useCallback, useEffect, useRef, useState } from "react";

type CheckInResponse = {
  ok?: boolean;
  status?: string;
  student_name?: string;
  activity?: string;
  starts_at?: string;
  ends_at?: string;
  checked_in_at?: string | null;
  available_at?: string;
};

type Feedback =
  | { kind: "success"; title: string; detail: string; meta?: string }
  | { kind: "duplicate"; title: string; detail: string; meta?: string }
  | { kind: "error"; title: string; detail: string; meta?: string }
  | null;

function formatTime(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function feedbackForDuration(kind: Exclude<Feedback, null>["kind"] | undefined) {
  if (kind === "error") return 5000;
  if (kind === "duplicate") return 4500;
  return 3800;
}

function feedbackFor(result: CheckInResponse): Feedback {
  const classLine = [result.activity, formatTime(result.starts_at)].filter(Boolean).join(" · ");

  if (result.status === "success") {
    return {
      kind: "success",
      title: "Asistencia registrada",
      detail: result.student_name ?? "Check-in correcto",
      meta: classLine,
    };
  }

  if (result.status === "already_attended") {
    return {
      kind: "duplicate",
      title: "Tu asistencia ya está registrada",
      detail: result.student_name ?? "Check-in ya realizado",
      meta: classLine,
    };
  }

  if (result.status === "too_early") {
    return {
      kind: "error",
      title: "Tu check-in todavía no está disponible",
      detail: result.available_at
        ? `Podrás registrarlo a partir de las ${formatTime(result.available_at)}.`
        : "Intenta de nuevo más cerca del inicio de tu clase.",
    };
  }

  if (result.status === "session_finished") {
    return {
      kind: "error",
      title: "El periodo de check-in terminó",
      detail: "Solicita apoyo al staff si necesitas una corrección.",
    };
  }

  if (result.status === "reservation_invalid") {
    return {
      kind: "error",
      title: "Esta reserva ya no es válida",
      detail: "Solicita apoyo al staff.",
    };
  }

  if (result.status === "unauthorized" || result.status === "forbidden") {
    return {
      kind: "error",
      title: "El kiosco necesita iniciar sesión",
      detail: "Solicita apoyo al staff para reactivar este dispositivo.",
    };
  }

  return {
    kind: "error",
    title: "No pudimos registrar tu asistencia",
    detail: "Revisa tu código QR o solicita apoyo al staff.",
  };
}

export function KioskScanner({ studioName }: { studioName: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const busyRef = useRef(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const resetReader = useCallback(() => {
    busyRef.current = false;
    setFeedback(null);
  }, []);

  const submitToken = useCallback(
    async (token: string) => {
      if (busyRef.current) return;
      busyRef.current = true;

      let nextFeedback: Feedback = null;

      try {
        const response = await fetch("/api/check-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          cache: "no-store",
        });
        const result = (await response.json()) as CheckInResponse;
        nextFeedback = feedbackFor(result);
        setFeedback(nextFeedback);
      } catch {
        nextFeedback = {
          kind: "error",
          title: "No hay conexión con Studio Flow",
          detail: "No se registró ninguna asistencia. Intenta de nuevo.",
        };
        setFeedback(nextFeedback);
      }

      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      const feedbackDurationMs = feedbackForDuration(nextFeedback?.kind);

      resetTimerRef.current = setTimeout(resetReader, feedbackDurationMs);
    },
    [resetReader],
  );

  useEffect(() => {
    let disposed = false;
    const reader = new BrowserQRCodeReader(undefined, {
      delayBetweenScanAttempts: 220,
      delayBetweenScanSuccess: 900,
    });

    async function start() {
      if (!videoRef.current) return;

      try {
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current,
          (result) => {
            if (!disposed && result) void submitToken(result.getText());
          },
        );

        if (disposed) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;
        setCameraError(null);
      } catch {
        if (!disposed) {
          setCameraError(
            "No pudimos acceder a la cámara. Revisa el permiso de cámara de este dispositivo.",
          );
        }
      }
    }

    void start();

    return () => {
      disposed = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, [submitToken]);

  const feedbackTone =
    feedback?.kind === "success"
      ? "border-emerald-200 bg-emerald-50"
      : feedback?.kind === "duplicate"
        ? "border-amber-200 bg-amber-50"
        : "border-rose-200 bg-rose-50";

  return (
    <main className="fixed inset-0 z-[300] overflow-auto bg-[#f5f8fb] text-[#10203a]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(23,168,120,0.08),transparent_38%)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#0f8f66]">
              STUDIO <span className="text-[#10203a]">FLOW</span>
            </p>
            <p className="mt-1 text-xs text-[#718096]">{studioName}</p>
          </div>
          <a
            href="/admin"
            className="rounded-full border border-[#dce4eb] bg-white px-4 py-2 text-xs font-semibold text-[#607086] shadow-sm transition hover:border-[#bfe3d6] hover:text-[#0f8f66]"
          >
            Salir del modo kiosco
          </a>
        </header>

        <section className="flex flex-1 flex-col items-center justify-center py-8">
          <div className="w-full max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#0f8f66]">
              Check-in
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">
              Escanea tu código QR
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#687891] sm:text-base">
              Acerca el código de tu reserva a la cámara para registrar tu asistencia.
            </p>
          </div>

          <div className="relative mt-8 aspect-[4/3] w-full max-w-2xl overflow-hidden rounded-[2rem] border border-[#bfe3d6] bg-[#101820] shadow-[0_22px_70px_rgba(44,64,86,0.12)]">
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              muted
              playsInline
              autoPlay
              aria-label="Cámara del lector de códigos QR"
            />

            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/35" />
            <div className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[58%] -translate-x-1/2 -translate-y-1/2 rounded-[1.75rem] border border-emerald-300/90 shadow-[0_0_32px_rgba(23,168,120,0.24)]">
              <span className="absolute -left-px -top-px h-10 w-10 rounded-tl-[1.7rem] border-l-4 border-t-4 border-emerald-300" />
              <span className="absolute -right-px -top-px h-10 w-10 rounded-tr-[1.7rem] border-r-4 border-t-4 border-emerald-300" />
              <span className="absolute -bottom-px -left-px h-10 w-10 rounded-bl-[1.7rem] border-b-4 border-l-4 border-emerald-300" />
              <span className="absolute -bottom-px -right-px h-10 w-10 rounded-br-[1.7rem] border-b-4 border-r-4 border-emerald-300" />
              {!feedback ? (
                <span className="absolute left-[8%] right-[8%] top-1/2 h-px bg-emerald-300/90 shadow-[0_0_16px_rgba(23,168,120,0.85)]" />
              ) : null}
            </div>

            {cameraError ? (
              <div className="absolute inset-0 flex items-center justify-center bg-white/95 p-8 text-center">
                <div>
                  <p className="text-lg font-semibold text-[#10203a]">Cámara no disponible</p>
                  <p className="mt-2 max-w-md text-sm leading-6 text-[#687891]">{cameraError}</p>
                </div>
              </div>
            ) : null}

            {feedback ? (
              <div className="absolute inset-0 flex items-center justify-center bg-white/90 p-6 backdrop-blur-sm">
                <div
                  className={`w-full max-w-lg rounded-[2rem] border p-7 text-center ${feedbackTone}`}
                >
                  <div
                    className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full border text-3xl ${
                      feedback.kind === "success"
                        ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                        : feedback.kind === "duplicate"
                          ? "border-amber-200 bg-amber-100 text-amber-700"
                          : "border-rose-200 bg-rose-100 text-rose-700"
                    }`}
                    aria-hidden="true"
                  >
                    {feedback.kind === "error" ? "!" : "✓"}
                  </div>
                  <h2 className="mt-4 text-2xl font-semibold">{feedback.title}</h2>
                  <p className="mt-2 text-base font-semibold text-[#10203a]">{feedback.detail}</p>
                  {feedback.meta ? (
                    <p className="mt-1 text-sm text-[#687891]">{feedback.meta}</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex items-center gap-2 text-xs text-[#718096]">
            <span className="h-2 w-2 rounded-full bg-[#17a878] shadow-[0_0_10px_rgba(23,168,120,0.35)]" />
            Lector listo
          </div>
        </section>
      </div>
    </main>
  );
}
