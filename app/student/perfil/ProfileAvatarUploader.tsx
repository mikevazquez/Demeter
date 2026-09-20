"use client";

import { useEffect, useState, type ChangeEvent } from "react";

import { createClient } from "@/lib/supabase/client";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export default function ProfileAvatarUploader({ initials }: { initials: string }) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
        // Avatar is optional. Keep initials if Storage is unavailable.
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
      setError("Usa una imagen JPG, PNG o WebP.");
      return;
    }

    if (file.size > MAX_AVATAR_BYTES) {
      setError("La imagen debe pesar máximo 5 MB.");
      return;
    }

    setError(null);
    setSuccess(false);
    setUploading(true);

    try {
      const supabase = createClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        setError("Tu sesión ya no está disponible. Vuelve a iniciar sesión.");
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
        setError("No pudimos subir la foto. Intenta de nuevo.");
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
        setError("La foto subió, pero no pudimos asociarla a tu perfil.");
        return;
      }

      const { data: signed } = await supabase.storage
        .from("profile-avatars")
        .createSignedUrl(avatarPath, 3600);

      if (signed?.signedUrl) setAvatarUrl(signed.signedUrl);
      setSuccess(true);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="shrink-0">
      <div
        aria-label="Foto de perfil"
        role="img"
        className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-fuchsia-400/50 bg-gradient-to-br from-fuchsia-500/70 to-fuchsia-950 bg-cover bg-center text-xl font-semibold text-white shadow-[0_0_28px_rgba(236,72,153,0.22)] sm:h-24 sm:w-24 sm:text-2xl"
        style={
          avatarUrl
            ? {
                backgroundImage: `url("${avatarUrl.replaceAll('"', "%22")}")`,
              }
            : undefined
        }
      >
        {avatarUrl ? <span className="sr-only">Foto de perfil actual</span> : initials}
      </div>

      <label
        className={`mt-2 inline-flex min-h-9 w-full cursor-pointer items-center justify-center rounded-xl border px-3 py-2 text-[11px] font-semibold transition ${
          uploading
            ? "cursor-wait border-white/10 text-zinc-500"
            : "border-fuchsia-500/35 bg-fuchsia-500/[0.08] text-fuchsia-200 hover:bg-fuchsia-500/[0.14]"
        }`}
      >
        {uploading ? "Subiendo…" : avatarUrl ? "Cambiar foto" : "Subir foto"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={uploading}
          onChange={handleFileChange}
        />
      </label>

      {success ? (
        <p className="mt-2 max-w-36 text-[10px] leading-4 text-emerald-300">
          Foto actualizada correctamente.
        </p>
      ) : null}
      {error ? <p className="mt-2 max-w-36 text-[10px] leading-4 text-rose-300">{error}</p> : null}
    </div>
  );
}
