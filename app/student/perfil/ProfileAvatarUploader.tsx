"use client";

import { useEffect, useState, type ChangeEvent } from "react";

import { createClient } from "@/lib/supabase/client";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export default function ProfileAvatarUploader({ initials }: { initials: string }) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadAvatar() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user || cancelled) return;

        const { data: profile } = await supabase
          .from("profiles")
          .select("avatar_url")
          .eq("id", user.id)
          .maybeSingle();

        if (!profile?.avatar_url || cancelled) return;

        const { data } = await supabase.storage
          .from("profile-avatars")
          .createSignedUrl(profile.avatar_url, 3600);

        if (!cancelled && data?.signedUrl) setAvatarUrl(data.signedUrl);
      } catch {
        // La foto es opcional: Perfil debe seguir funcionando aunque Storage falle.
      }
    }

    void loadAvatar();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;

    if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
      setFailed(true);
      setMessage("Usa JPG, PNG o WebP.");
      return;
    }

    if (file.size > MAX_AVATAR_BYTES) {
      setFailed(true);
      setMessage("Máximo 5 MB.");
      return;
    }

    setUploading(true);
    setFailed(false);
    setMessage(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        setFailed(true);
        setMessage("Vuelve a iniciar sesión.");
        return;
      }

      const avatarPath = `${user.id}/avatar`;
      const { error: uploadError } = await supabase.storage
        .from("profile-avatars")
        .upload(avatarPath, file, {
          cacheControl: "3600",
          contentType: file.type,
          upsert: true,
        });

      if (uploadError) {
        setFailed(true);
        setMessage("No pudimos subir la foto.");
        return;
      }

      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          avatar_url: avatarPath,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (profileError) {
        setFailed(true);
        setMessage("No pudimos guardar la foto.");
        return;
      }

      const { data: signed } = await supabase.storage
        .from("profile-avatars")
        .createSignedUrl(avatarPath, 3600);

      if (signed?.signedUrl) setAvatarUrl(signed.signedUrl);
      setMessage("Foto actualizada");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="shrink-0 text-center">
      <div
        className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-fuchsia-400/50 bg-gradient-to-br from-fuchsia-500/70 to-fuchsia-950 bg-cover bg-center text-xl font-semibold text-white shadow-[0_0_28px_rgba(236,72,153,0.22)] sm:h-20 sm:w-20 sm:text-2xl"
        style={
          avatarUrl
            ? {
                backgroundImage: `url("${avatarUrl.replaceAll('"', "%22")}")`,
              }
            : undefined
        }
        aria-label="Foto de perfil"
      >
        {avatarUrl ? <span className="sr-only">Foto de perfil actual</span> : initials}
      </div>

      <label className="mt-2 inline-flex cursor-pointer items-center justify-center rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-semibold text-zinc-300 transition hover:border-fuchsia-500/35 hover:text-white">
        {uploading ? "Subiendo…" : avatarUrl ? "Cambiar" : "Subir foto"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={uploading}
          onChange={handleFileChange}
        />
      </label>

      {message ? (
        <p
          className={`mt-1 max-w-24 text-[9px] leading-3 ${
            failed ? "text-rose-300" : "text-emerald-300"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
