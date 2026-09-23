"use client";

import { useState } from "react";

type PushState = "available" | "active" | "needs_install" | "denied" | "unsupported" | "error";

type PushStatusSnapshot = {
  active_subscriptions?: number;
};

function isIosDevice() {
  if (typeof navigator === "undefined") return false;

  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
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

function supportsPush() {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);

  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function equalKeys(left: ArrayBuffer | null, right: Uint8Array) {
  if (!left) return false;

  const leftBytes = new Uint8Array(left);
  if (leftBytes.length !== right.length) return false;

  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== right[index]) return false;
  }

  return true;
}

async function serviceWorkerRegistration() {
  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
  });

  await navigator.serviceWorker.ready;
  return registration;
}

function deviceLabel() {
  if (isIosDevice()) return "iPhone / iPad";
  if (/Android/i.test(navigator.userAgent)) return "Android";
  if (/Macintosh|Mac OS X/i.test(navigator.userAgent)) return "Mac";
  if (/Windows/i.test(navigator.userAgent)) return "Windows";

  return "Navegador";
}

async function browserClient() {
  const { createClient } = await import("@/lib/supabase/client");
  return createClient();
}

export default function PushNotificationSettings({ studioId }: { studioId: string }) {
  const [state, setState] = useState<PushState>("available");
  const [deviceCount, setDeviceCount] = useState(0);
  const [busy, setBusy] = useState<"activate" | "deactivate" | "test" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refreshServerStatus() {
    try {
      const supabase = await browserClient();
      const { data, error } = await supabase.rpc("get_my_push_notification_status", {
        p_studio_id: studioId,
      });

      if (error) return;

      const snapshot = (data ?? {}) as PushStatusSnapshot;
      setDeviceCount(snapshot.active_subscriptions ?? 0);
    } catch {
      // El estado del servidor es informativo y nunca debe impedir abrir esta pantalla.
    }
  }

  async function activate() {
    setBusy("activate");
    setMessage(null);

    try {
      if (isIosDevice() && !isStandalone()) {
        setState("needs_install");
        return;
      }

      if (!supportsPush()) {
        setState("unsupported");
        return;
      }

      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "available");
        return;
      }

      const supabase = await browserClient();
      const { data: rawPublicKey, error: keyError } = await supabase.rpc(
        "get_push_vapid_public_key",
      );

      if (keyError || typeof rawPublicKey !== "string" || !rawPublicKey) {
        throw new Error("push_vapid_unavailable");
      }

      const applicationServerKey = urlBase64ToUint8Array(rawPublicKey);
      const registration = await serviceWorkerRegistration();
      let subscription = await registration.pushManager.getSubscription();

      if (
        subscription &&
        !equalKeys(subscription.options.applicationServerKey, applicationServerKey)
      ) {
        await subscription.unsubscribe();
        subscription = null;
      }

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey as BufferSource,
        });
      }

      const serialized = subscription.toJSON();
      const endpoint = serialized.endpoint;
      const p256dh = serialized.keys?.p256dh;
      const auth = serialized.keys?.auth;

      if (!endpoint || !p256dh || !auth) {
        throw new Error("push_subscription_incomplete");
      }

      const { error: registerError } = await supabase.rpc("register_my_push_subscription", {
        p_studio_id: studioId,
        p_endpoint: endpoint,
        p_p256dh: p256dh,
        p_auth: auth,
        p_user_agent: navigator.userAgent,
        p_device_label: deviceLabel(),
        p_expiration_time: subscription.expirationTime,
      });

      if (registerError) throw registerError;

      setState("active");
      setMessage("Notificaciones activadas en este dispositivo.");
      await refreshServerStatus();
    } catch {
      setState("error");
      setMessage("No pudimos activar Push. Intenta de nuevo.");
    } finally {
      setBusy(null);
    }
  }

  async function deactivate() {
    setBusy("deactivate");
    setMessage(null);

    try {
      if (!supportsPush()) {
        setState("unsupported");
        return;
      }

      const supabase = await browserClient();
      const registration = await serviceWorkerRegistration();
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const { error } = await supabase.rpc("unregister_my_push_subscription", {
          p_studio_id: studioId,
          p_endpoint: subscription.endpoint,
        });

        if (error) throw error;
        await subscription.unsubscribe();
      }

      setState(Notification.permission === "denied" ? "denied" : "available");
      setMessage("Push desactivado en este dispositivo.");
      await refreshServerStatus();
    } catch {
      setState("error");
      setMessage("No pudimos desactivar Push. Intenta nuevamente.");
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setBusy("test");
    setMessage(null);

    try {
      const supabase = await browserClient();
      const { data, error } = await supabase.functions.invoke("send-push-notification", {
        body: {
          mode: "self_test",
          studio_id: studioId,
        },
      });

      if (error || !data?.ok || (data.delivered ?? 0) < 1) {
        throw error ?? new Error("push_test_failed");
      }

      setMessage("Prueba enviada. Debes recibir una notificación de Studio Flow.");
    } catch {
      setMessage("La prueba no pudo enviarse. Revisaremos el registro técnico.");
    } finally {
      setBusy(null);
      await refreshServerStatus();
    }
  }

  const stateCopy = {
    available: {
      title: "Push disponible",
      description: "Actívalo para recibir cambios importantes de clases, evaluaciones y eventos.",
    },
    active: {
      title: "Push activo",
      description: "Este dispositivo ya puede recibir avisos de Studio Flow.",
    },
    needs_install: {
      title: "Instala Studio Flow en tu iPhone",
      description:
        "En Safari toca Compartir → Agregar a pantalla de inicio. Después abre Studio Flow desde el nuevo icono y vuelve aquí.",
    },
    denied: {
      title: "Permiso bloqueado",
      description:
        "El navegador tiene las notificaciones bloqueadas. Cámbialo en los ajustes del sistema o del sitio para poder activarlas.",
    },
    unsupported: {
      title: "Push no disponible aquí",
      description:
        "Este navegador o contexto no admite Web Push. Puedes seguir usando Studio Flow normalmente.",
    },
    error: {
      title: "No pudimos activar Push",
      description: "La configuración no quedó lista en este intento. Puedes volver a intentarlo.",
    },
  } satisfies Record<PushState, { title: string; description: string }>;

  const copy = stateCopy[state];
  const activeElsewhere = state !== "active" && deviceCount > 0;

  return (
    <section
      data-profile-block="push-notifications"
      className="rounded-3xl border border-fuchsia-500/20 bg-[radial-gradient(circle_at_100%_0%,rgba(236,72,153,0.12),transparent_36%),rgba(255,255,255,0.025)] p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
            Notificaciones Push
          </p>
          <h2 className="mt-2 text-lg font-semibold text-white">{copy.title}</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-400">{copy.description}</p>
        </div>

        <span
          className={
            "rounded-full border px-2.5 py-1 text-[10px] font-semibold " +
            (state === "active"
              ? "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-300"
              : state === "denied" || state === "error"
                ? "border-rose-400/30 bg-rose-400/[0.08] text-rose-200"
                : "border-white/10 bg-white/[0.04] text-zinc-300")
          }
        >
          {state === "active" ? "Activo" : "No activo"}
        </span>
      </div>

      {deviceCount > 0 ? (
        <p className="mt-3 text-[11px] text-zinc-500">
          {deviceCount} dispositivo{deviceCount === 1 ? "" : "s"} activo
          {deviceCount === 1 ? "" : "s"} en tu cuenta.
          {activeElsewhere ? " Este dispositivo todavía no está activado." : ""}
        </p>
      ) : null}

      {message ? (
        <p className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-zinc-300">
          {message}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {state === "available" || state === "error" ? (
          <button
            type="button"
            onClick={() => void activate()}
            disabled={busy !== null}
            className="min-h-11 rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:cursor-wait disabled:opacity-60"
          >
            {busy === "activate" ? "Activando…" : "Activar notificaciones"}
          </button>
        ) : null}

        {state === "active" ? (
          <>
            <button
              type="button"
              onClick={() => void sendTest()}
              disabled={busy !== null}
              className="min-h-11 rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:cursor-wait disabled:opacity-60"
            >
              {busy === "test" ? "Enviando…" : "Enviar prueba"}
            </button>
            <button
              type="button"
              onClick={() => void deactivate()}
              disabled={busy !== null}
              className="min-h-11 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition hover:bg-white/[0.05] hover:text-white disabled:cursor-wait disabled:opacity-60"
            >
              {busy === "deactivate" ? "Desactivando…" : "Desactivar aquí"}
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}
