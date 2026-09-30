"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isIosDevice() {
  if (typeof navigator === "undefined") return false;

  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isAndroidDevice() {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

function isStandalone() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const navigatorWithStandalone = navigator as Navigator & {
    standalone?: boolean;
  };

  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    navigatorWithStandalone.standalone === true
  );
}

function platformLabel() {
  if (isIosDevice()) return "iOS";
  if (isAndroidDevice()) return "Android";
  if (/Macintosh|Mac OS X/i.test(navigator.userAgent)) return "macOS";
  if (/Windows/i.test(navigator.userAgent)) return "Windows";
  return "Navegador";
}

async function browserClient(studioId: string) {
  const { createClient } = await import("@/lib/supabase/client");
  return createClient(studioId);
}

export default function OnboardingInstallStep({
  complete,
  studioId,
  studioName,
}: {
  complete: boolean;
  studioId: string;
  studioName: string;
}) {
  const router = useRouter();
  const [standalone, setStandalone] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<DeferredInstallPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const ios = isIosDevice();
      const android = isAndroidDevice();
      setPlatform(ios ? "ios" : android ? "android" : "other");

      const installed = isStandalone();
      setStandalone(installed);

      if (!complete && installed) {
        void (async () => {
          try {
            const supabase = await browserClient(studioId);
            const { error } = await supabase.rpc("student_confirm_reward_app_installation", {
              p_display_mode: ios ? "ios-standalone" : "standalone",
              p_platform: platformLabel(),
            });

            if (error) throw error;
            router.refresh();
          } catch {
            setMessage("Detectamos la app instalada, pero no pudimos registrar este paso.");
          }
        })();
      }
    }, 0);

    function capturePrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as DeferredInstallPrompt);
    }

    function installedHandler() {
      setMessage(`Listo. Ahora abre ${studioName} desde el nuevo icono para completar este paso.`);
    }

    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, [complete, router, studioId, studioName]);

  async function requestInstall() {
    if (!installPrompt) return;

    setBusy(true);
    setMessage(null);

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);

      setMessage(
        choice.outcome === "accepted"
          ? `Instalación iniciada. Cuando termine, abre ${studioName} desde el icono de tu pantalla de inicio.`
          : "La instalación no se completó. Puedes intentarlo de nuevo desde el menú del navegador.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (complete) return null;

  return (
    <section className="rounded-3xl border border-fuchsia-500/20 bg-fuchsia-500/[0.04] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
        Paso 3 · Guarda la app
      </p>
      <h3 className="mt-1 text-base font-semibold text-white">
        Agrega {studioName} a tu pantalla de inicio
      </h3>

      {standalone ? (
        <p className="mt-2 text-xs leading-5 text-zinc-400">
          Ya abriste {studioName} como aplicación. Estamos registrando este paso.
        </p>
      ) : platform === "ios" ? (
        <ol className="mt-3 space-y-2 text-xs leading-5 text-zinc-300">
          <li>1. Abre esta página en Safari.</li>
          <li>2. Toca el botón Compartir.</li>
          <li>3. Elige “Agregar a pantalla de inicio”.</li>
          <li>4. Toca “Agregar”.</li>
          <li>5. Cierra Safari y abre {studioName} desde el nuevo icono.</li>
        </ol>
      ) : platform === "android" ? (
        <ol className="mt-3 space-y-2 text-xs leading-5 text-zinc-300">
          <li>1. Abre el menú de Chrome.</li>
          <li>2. Elige “Instalar app” o “Agregar a pantalla de inicio”.</li>
          <li>3. Confirma la instalación.</li>
          <li>4. Abre {studioName} desde el nuevo icono.</li>
        </ol>
      ) : (
        <ol className="mt-3 space-y-2 text-xs leading-5 text-zinc-300">
          <li>1. Abre el menú del navegador.</li>
          <li>2. Elige “Instalar app” o “Agregar a pantalla de inicio”.</li>
          <li>3. Abre {studioName} desde el nuevo icono.</li>
        </ol>
      )}

      {installPrompt && !standalone ? (
        <button
          type="button"
          onClick={() => void requestInstall()}
          disabled={busy}
          className="mt-4 min-h-11 w-full rounded-xl bg-fuchsia-600 px-4 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? "Abriendo instalación…" : "Instalar aplicación"}
        </button>
      ) : null}

      {message ? (
        <p className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-zinc-300">
          {message}
        </p>
      ) : null}
    </section>
  );
}
