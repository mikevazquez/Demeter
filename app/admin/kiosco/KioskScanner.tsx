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

      try {
        const response = await fetch("/api/check-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          cache: "no-store",
        });
        const result = (await response.json()) as CheckInResponse;
        const nextFeedback = feedbackFor(result);
        setFeedback(nextFeedback);
      } catch {
        setFeedback({
          kind: "error",
          title: "No hay conexión con Studio Flow",
          detail: "No se registró ninguna asistencia. Intenta de nuevo.",
        });
      }

      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      const feedbackDurationMs =
        feedbackForDuration(nextFeedback?.kind);

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
      ? "border-emerald-400/25 bg-emerald-400/[0.11]"
      : feedback?.kind === "duplicate"
        ? "border-fuchsia-400/25 bg-fuchsia-500/[0.1]"
        : "border-rose-400/25 bg-rose-500/[0.1]";

  return (
    <main className="fixed inset-0 z-[300] overflow-auto bg-[#07070a] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(255,10,138,0.15),transparent_35%)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-fuchsia-300">
              STUDIO <span className="text-white">FLOW</span>
            </p>
            <p className="mt-1 text-xs text-zinc-500">{studioName}</p>
          </div>
          <a
            href="/admin"
            className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-zinc-300 transition hover:border-fuchsia-400/30 hover:text-white"
          >
            Salir del modo kiosco
          </a>
        </header>

        <section className="flex flex-1 flex-col items-center justify-center py-8">
          <div className="w-full max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
              Check-in
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">
              Escanea tu código QR
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-zinc-400 sm:text-base">
              Acerca el código de tu reserva a la cámara para registrar tu asistencia.
            </p>
          </div>

          <div className="relative mt-8 aspect-[4/3] w-full max-w-2xl overflow-hidden rounded-[2rem] border border-fuchsia-500/25 bg-[#0e0e13] shadow-[0_0_70px_rgba(255,10,138,0.08)]">
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              muted
              playsInline
              autoPlay
              aria-label="Cámara del lector de códigos QR"
            />

            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/35" />
            <div className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[58%] -translate-x-1/2 -translate-y-1/2 rounded-[1.75rem] border border-fuchsia-400/80 shadow-[0_0_32px_rgba(255,10,138,0.22)]">
              <span className="absolute -left-px -top-px h-10 w-10 rounded-tl-[1.7rem] border-l-4 border-t-4 border-fuchsia-400" />
              <span className="absolute -right-px -top-px h-10 w-10 rounded-tr-[1.7rem] border-r-4 border-t-4 border-fuchsia-400" />
              <span className="absolute -bottom-px -left-px h-10 w-10 rounded-bl-[1.7rem] border-b-4 border-l-4 border-fuchsia-400" />
              <span className="absolute -bottom-px -right-px h-10 w-10 rounded-br-[1.7rem] border-b-4 border-r-4 border-fuchsia-400" />
              {!feedback ? (
                <span className="absolute left-[8%] right-[8%] top-1/2 h-px bg-fuchsia-300/80 shadow-[0_0_16px_rgba(255,10,138,0.9)]" />
              ) : null}
            </div>

            {cameraError ? (
              <div className="absolute inset-0 flex items-center justify-center bg-[#09090d]/95 p-8 text-center">
                <div>
                  <p className="text-lg font-semibold text-white">Cámara no disponible</p>
                  <p className="mt-2 max-w-md text-sm leading-6 text-zinc-400">{cameraError}</p>
                </div>
              </div>
            ) : null}

            {feedback ? (
              <div className="absolute inset-0 flex items-center justify-center bg-[#09090d]/92 p-6 backdrop-blur-sm">
                <div
                  className={`w-full max-w-lg rounded-[2rem] border p-7 text-center ${feedbackTone}`}
                >
                  <div
                    className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full border text-3xl ${
                      feedback.kind === "success"
                        ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-200"
                        : feedback.kind === "duplicate"
                          ? "border-fuchsia-300/40 bg-fuchsia-300/10 text-fuchsia-200"
                          : "border-rose-300/40 bg-rose-300/10 text-rose-200"
                    }`}
                    aria-hidden="true"
                  >
                    {feedback.kind === "error" ? "!" : "✓"}
                  </div>
                  <h2 className="mt-4 text-2xl font-semibold">{feedback.title}</h2>
                  <p className="mt-2 text-base font-semibold text-white">{feedback.detail}</p>
                  {feedback.meta ? (
                    <p className="mt-1 text-sm text-zinc-400">{feedback.meta}</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex items-center gap-2 text-xs text-zinc-500">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.55)]" />
            Lector listo
          </div>
        </section>
      </div>
    </main>
  );
}
