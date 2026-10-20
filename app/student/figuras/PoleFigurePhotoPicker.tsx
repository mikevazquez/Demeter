"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { finalizeStudentPoleFigurePhotoAction } from "../actions";

const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

export default function PoleFigurePhotoPicker({
  elementId,
  hasPhoto,
}: {
  elementId: string;
  hasPhoto: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function uploadPhoto() {
    if (!file) {
      setStatus("error");
      setError("Selecciona una foto antes de guardar.");
      return;
    }

    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
      setStatus("error");
      setError("Usa una imagen JPG, PNG o WebP.");
      return;
    }

    if (file.size > MAX_PHOTO_SIZE) {
      setStatus("error");
      setError("La imagen debe pesar máximo 5 MB.");
      return;
    }

    setStatus("uploading");
    setError(null);

    const supabase = createClient("student");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setStatus("error");
      setError("Tu sesión expiró. Vuelve a iniciar sesión.");
      return;
    }

    const photoPath = `${user.id}/${elementId}/photo`;
    const { error: uploadError } = await supabase.storage
      .from("pole-achievement-photos")
      .upload(photoPath, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      setStatus("error");
      setError("No pudimos subir la foto. Intenta nuevamente.");
      return;
    }

    const result = await finalizeStudentPoleFigurePhotoAction(elementId, photoPath);
    if (!result.ok) {
      setStatus("error");
      setError("La foto subió, pero no pudimos asociarla a la figura.");
      return;
    }

    setFile(null);
    setStatus("idle");
    router.refresh();
  }

  return (
    <div className="mt-3 space-y-2">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          setStatus("idle");
          setError(null);
        }}
      />

      <div className="flex flex-wrap gap-2">
        <label
          htmlFor={inputId}
          className="sendero-button sendero-button-ghost !min-h-9 cursor-pointer !px-3 !text-[11px]"
        >
          {hasPhoto ? "Cambiar foto" : "Agregar foto"}
        </label>
        {file ? (
          <button
            type="button"
            onClick={uploadPhoto}
            disabled={status === "uploading"}
            className="sendero-button sendero-button-primary !min-h-9 !px-3 !text-[11px] disabled:opacity-60"
          >
            {status === "uploading" ? "Guardando…" : "Guardar foto"}
          </button>
        ) : null}
      </div>

      {file ? <p className="truncate text-[10px] text-zinc-500">{file.name}</p> : null}
      {error ? (
        <p role="alert" className="text-[10px] text-[var(--sendero-coral)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
