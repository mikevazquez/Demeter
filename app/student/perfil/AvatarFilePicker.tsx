"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

import { finalizeStudentAvatarAction } from "../actions";

const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];

export default function AvatarFilePicker() {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function uploadAvatar() {
    if (!file) {
      setStatus("error");
      setErrorMessage("Selecciona una foto antes de guardar.");
      return;
    }

    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setStatus("error");
      setErrorMessage("Usa una imagen JPG, PNG o WebP.");
      return;
    }

    if (file.size > MAX_AVATAR_SIZE) {
      setStatus("error");
      setErrorMessage("La imagen debe pesar máximo 5 MB.");
      return;
    }

    setStatus("uploading");
    setErrorMessage(null);

    const supabase = createClient("student");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setStatus("error");
      setErrorMessage("Tu sesión expiró. Vuelve a iniciar sesión.");
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
      setStatus("error");
      setErrorMessage("No pudimos subir la foto. Intenta nuevamente.");
      return;
    }

    const result = await finalizeStudentAvatarAction(avatarPath);
    if (!result.ok) {
      setStatus("error");
      setErrorMessage("La foto subió, pero no pudimos guardarla en tu perfil. Intenta nuevamente.");
      return;
    }

    router.replace("/student/perfil?avatar=updated");
    router.refresh();
  }

  return (
    <div className="w-28 space-y-1.5">
      <input
        ref={inputRef}
        id={inputId}
        name="avatar"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(event) => {
          const selectedFile = event.target.files?.[0] ?? null;
          setFile(selectedFile);
          setStatus("idle");
          setErrorMessage(null);
        }}
      />

      <label
        htmlFor={inputId}
        className="inline-flex min-h-8 w-full cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/[0.035] px-2 py-1 text-[10px] font-semibold text-zinc-300 transition hover:border-fuchsia-500/35 hover:text-white"
      >
        Cargar foto
      </label>

      <div aria-live="polite" className="min-h-4">
        {file ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="block max-w-28 truncate text-left text-[10px] font-medium text-sky-400 underline decoration-sky-400/70 underline-offset-2 hover:text-sky-300"
            title={file.name}
            aria-label={`Cambiar foto seleccionada: ${file.name}`}
          >
            {file.name}
          </button>
        ) : (
          <p className="text-[9px] leading-4 text-zinc-500">JPG, PNG o WebP · máx. 5 MB</p>
        )}
      </div>

      <button
        type="button"
        onClick={uploadAvatar}
        disabled={!file || status === "uploading"}
        className="min-h-8 w-full rounded-lg border border-white/10 px-2 py-1 text-[10px] font-semibold text-zinc-300 transition hover:border-fuchsia-500/35 hover:text-white disabled:cursor-wait disabled:opacity-60"
      >
        {status === "uploading" ? "Guardando…" : "Guardar foto"}
      </button>

      {errorMessage ? (
        <p role="alert" className="text-[9px] leading-4 text-red-300">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
