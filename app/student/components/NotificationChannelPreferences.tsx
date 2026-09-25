"use client";

import { useEffect, useState } from "react";

type Preferences = {
  push_enabled: boolean;
  whatsapp_enabled: boolean;
  email_enabled: boolean;
};

type DeviceState =
  | "checking"
  | "connected"
  | "permission_needed"
  | "blocked"
  | "needs_install"
  | "unsupported"
  | "error";

function isIosDevice() {
  if (typeof navigator === "undefined") return false;

  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const nav = navigator as Navigator & { standalone?: boolean };

  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true
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

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={
        "relative h-7 w-12 shrink-0 rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500 " +
        (checked ? "border-fuchsia-400/50 bg-fuchsia-500" : "border-white/15 bg-white/[0.06]") +
        (disabled ? " cursor-wait opacity-50" : "")
      }
    >
      <span
        className={
          "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition " +
          (checked ? "left-6" : "left-1")
        }
      />
    </button>
  );
}

export default function NotificationChannelPreferences({
  studioId,
  studioName,
  initialPreferences,
}: {
  studioId: string;
  studioName: string;
  initialPreferences: Preferences;
}) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [deviceState, setDeviceState] = useState<DeviceState>("checking");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function setPreference(channel: "push" | "whatsapp", enabled: boolean) {
    const supabase = await browserClient();
    const { data, error } = await supabase.rpc("student_set_notification_channel_preference", {
      p_channel_key: channel,
      p_enabled: enabled,
    });

    if (error) throw error;

    const next = (data ?? {}) as Partial<Preferences>;
    setPreferences((current) => ({ ...current, ...next }));
  }

  async function ensurePushConnection(requestPermission: boolean): Promise<DeviceState> {
    if (!preferences.push_enabled && !requestPermission) {
      setDeviceState("checking");
      return "checking";
    }

    if (isIosDevice() && !isStandalone()) {
      setDeviceState("needs_install");
      return "needs_install";
    }

    if (!supportsPush()) {
      setDeviceState("unsupported");
      return "unsupported";
    }

    let permission = Notification.permission;

    if (permission === "default" && requestPermission) {
      permission = await Notification.requestPermission();
    }

    if (permission === "denied") {
      setDeviceState("blocked");
      return "blocked";
    }

    if (permission !== "granted") {
      setDeviceState("permission_needed");
      return "permission_needed";
    }

    const supabase = await browserClient();
    const { data: rawPublicKey, error: keyError } = await supabase.rpc("get_push_vapid_public_key");

    if (keyError || typeof rawPublicKey !== "string" || !rawPublicKey) {
      throw new Error("push_vapid_unavailable");
    }

    const applicationServerKey = urlBase64ToUint8Array(rawPublicKey);
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });

    await navigator.serviceWorker.ready;

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

    setDeviceState("connected");
    return "connected";
  }

  useEffect(() => {
    let cancelled = false;

    if (!preferences.push_enabled) return;

    void (async () => {
      try {
        await ensurePushConnection(false);
      } catch {
        if (!cancelled) setDeviceState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
    // La conexión del dispositivo se revisa cuando cambia la preferencia persistente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences.push_enabled, studioId]);

  async function togglePush() {
    const next = !preferences.push_enabled;
    setBusy("push");
    setMessage(null);

    try {
      await setPreference("push", next);

      if (next) {
        const state = await ensurePushConnection(true);
        if (state === "connected") setMessage(`Push activado en ${studioName}.`);
      } else {
        setDeviceState("checking");
        setMessage("Push desactivado.");
      }
    } catch {
      setMessage("No pudimos guardar tu preferencia de Push.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleWhatsApp() {
    setBusy("whatsapp");
    setMessage(null);

    try {
      await setPreference("whatsapp", !preferences.whatsapp_enabled);
    } catch {
      setMessage("No pudimos guardar tu preferencia de WhatsApp.");
    } finally {
      setBusy(null);
    }
  }

  const pushDetail = !preferences.push_enabled
    ? "Push desactivado"
    : deviceState === "connected"
      ? "Push activado ✓"
      : deviceState === "blocked"
        ? "Las notificaciones están bloqueadas en este dispositivo"
        : deviceState === "permission_needed"
          ? "Push necesita permiso en este dispositivo"
          : deviceState === "needs_install"
            ? "Instala Demeter para recibir notificaciones Push"
            : deviceState === "unsupported"
              ? "Este navegador no admite notificaciones Push"
              : deviceState === "error"
                ? "Push activado · falta reconectar este dispositivo"
                : "Push activado";

  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
      <div className="border-b border-white/10 px-5 py-4">
        <h2 className="text-base font-semibold text-white">Cómo recibir tus avisos</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-400">
          Puedes cambiar estas preferencias cuando quieras.
        </p>
      </div>

      <div className="divide-y divide-white/10">
        <div className="flex min-h-20 items-center gap-4 px-5 py-4">
          <div className="min-w-0 flex-1">
            <strong className="block text-sm font-semibold text-white">Push</strong>
            <span className="mt-1 block text-sm leading-5 text-zinc-500">{pushDetail}</span>
          </div>
          <Toggle
            checked={preferences.push_enabled}
            disabled={busy !== null}
            onChange={() => void togglePush()}
            label="Notificaciones Push"
          />
        </div>

        <div className="flex min-h-20 items-center gap-4 px-5 py-4">
          <div className="min-w-0 flex-1">
            <strong className="block text-sm font-semibold text-white">WhatsApp</strong>
            <span className="mt-1 block text-sm leading-5 text-zinc-500">
              Reservas, recordatorios y avisos importantes.
            </span>
          </div>
          <Toggle
            checked={preferences.whatsapp_enabled}
            disabled={busy !== null}
            onChange={() => void toggleWhatsApp()}
            label="Notificaciones por WhatsApp"
          />
        </div>

        <div className="flex min-h-20 items-center gap-4 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-sm font-semibold text-zinc-300">Correo</strong>
              <span className="rounded-full border border-white/10 bg-white/[0.035] px-2 py-0.5 text-xs font-semibold text-zinc-500">
                Próximamente
              </span>
            </div>
            <span className="mt-1 block text-sm leading-5 text-zinc-600">
              Estará disponible cuando el envío por correo esté activo.
            </span>
          </div>
        </div>
      </div>

      {message ? (
        <p className="border-t border-white/10 px-5 py-3 text-sm text-zinc-400">{message}</p>
      ) : null}
    </section>
  );
}
