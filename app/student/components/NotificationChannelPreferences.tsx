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
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    nav.standalone === true
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
        "relative h-7 w-12 shrink-0 rounded-full border transition " +
        (checked
          ? "border-fuchsia-400/50 bg-fuchsia-500"
          : "border-white/15 bg-white/[0.06]") +
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

  async function setPreference(
    channel: "push" | "whatsapp" | "email",
    enabled: boolean,
  ) {
    const supabase = await browserClient();
    const { data, error } = await supabase.rpc(
      "student_set_notification_channel_preference",
      {
        p_channel_key: channel,
        p_enabled: enabled,
      },
    );

    if (error) throw error;

    const next = (data ?? {}) as Partial<Preferences>;
    setPreferences((current) => ({ ...current, ...next }));
  }

  async function ensurePushConnection(requestPermission: boolean) {
    if (!preferences.push_enabled && !requestPermission) {
      setDeviceState("checking");
      return;
    }

    if (isIosDevice() && !isStandalone()) {
      setDeviceState("needs_install");
      return;
    }

    if (!supportsPush()) {
      setDeviceState("unsupported");
      return;
    }

    let permission = Notification.permission;

    if (permission === "default" && requestPermission) {
      permission = await Notification.requestPermission();
    }

    if (permission === "denied") {
      setDeviceState("blocked");
      return;
    }

    if (permission !== "granted") {
      setDeviceState("permission_needed");
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

    const { error: registerError } = await supabase.rpc(
      "register_my_push_subscription",
      {
        p_studio_id: studioId,
        p_endpoint: endpoint,
        p_p256dh: p256dh,
        p_auth: auth,
        p_user_agent: navigator.userAgent,
        p_device_label: deviceLabel(),
        p_expiration_time: subscription.expirationTime,
      },
    );

    if (registerError) throw registerError;

    setDeviceState("connected");
  }

  useEffect(() => {
    let cancelled = false;

    if (!preferences.push_enabled) {
      setDeviceState("checking");
      return;
    }

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
    // Solo reintentamos cuando cambia la preferencia persistente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences.push_enabled, studioId]);

  async function togglePush() {
    const next = !preferences.push_enabled;
    setBusy("push");
    setMessage(null);

    try {
      await setPreference("push", next);

      if (next) {
        await ensurePushConnection(true);
        setMessage(`Push activado en ${studioName}.`);
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

  async function toggleChannel(channel: "whatsapp" | "email") {
    const key = channel + "_enabled" as "whatsapp_enabled" | "email_enabled";
    setBusy(channel);
    setMessage(null);

    try {
      await setPreference(channel, !preferences[key]);
    } catch {
      setMessage("No pudimos guardar esa preferencia.");
    } finally {
      setBusy(null);
    }
  }

  const pushDetail = !preferences.push_enabled
    ? "Desactivado"
    : deviceState === "connected"
      ? "Activo en este dispositivo"
      : deviceState === "blocked"
        ? "Activo en Demeter · bloqueado por iPhone"
        : deviceState === "permission_needed"
          ? "Activo en Demeter · falta permitirlo en este dispositivo"
          : deviceState === "needs_install"
            ? "Activo en Demeter · abre la app instalada para conectarlo"
            : deviceState === "unsupported"
              ? "Activo en Demeter · este navegador no admite Push"
              : deviceState === "error"
                ? "Activo en Demeter · reconexión pendiente"
                : "Activo en Demeter";

  return (
    <section className="overflow-hidden rounded-3xl border border-fuchsia-500/20 bg-[radial-gradient(circle_at_100%_0%,rgba(236,72,153,0.1),transparent_34%),rgba(255,255,255,0.025)]">
      <div className="border-b border-white/10 px-5 py-4">
        <h2 className="text-base font-semibold text-white">Canales</h2>
        <p className="mt-1 text-xs leading-5 text-zinc-400">
          Tu elección se mantiene hasta que tú la cambies.
        </p>
      </div>

      <div className="divide-y divide-white/10">
        <div className="flex items-center gap-4 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-fuchsia-500/10 text-lg text-fuchsia-300">
            ◉
          </div>
          <div className="min-w-0 flex-1">
            <strong className="block text-sm font-semibold text-white">Push</strong>
            <span className="mt-0.5 block text-xs text-zinc-500">{pushDetail}</span>
          </div>
          <Toggle
            checked={preferences.push_enabled}
            disabled={busy !== null}
            onChange={() => void togglePush()}
            label="Notificaciones Push"
          />
        </div>

        <div className="flex items-center gap-4 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-lg text-emerald-300">
            ◌
          </div>
          <div className="min-w-0 flex-1">
            <strong className="block text-sm font-semibold text-white">WhatsApp</strong>
            <span className="mt-0.5 block text-xs text-zinc-500">
              Confirmaciones, recordatorios y avisos importantes.
            </span>
          </div>
          <Toggle
            checked={preferences.whatsapp_enabled}
            disabled={busy !== null}
            onChange={() => void toggleChannel("whatsapp")}
            label="Notificaciones por WhatsApp"
          />
        </div>

        <div className="flex items-center gap-4 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-500/10 text-lg text-sky-300">
            ✉
          </div>
          <div className="min-w-0 flex-1">
            <strong className="block text-sm font-semibold text-white">Correo</strong>
            <span className="mt-0.5 block text-xs text-zinc-500">
              Guardaremos tu preferencia; el envío por correo se activará cuando el proveedor esté
              conectado.
            </span>
          </div>
          <Toggle
            checked={preferences.email_enabled}
            disabled={busy !== null}
            onChange={() => void toggleChannel("email")}
            label="Notificaciones por correo"
          />
        </div>
      </div>

      {message ? (
        <p className="border-t border-white/10 px-5 py-3 text-xs text-zinc-400">{message}</p>
      ) : null}
    </section>
  );
}
