"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";

export default function AvatarFilePicker({ initials }: { initials: string }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <input
        ref={inputRef}
        id={inputId}
        name="avatar"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        required
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;

          if (previewUrl) URL.revokeObjectURL(previewUrl);
          setFileName(file?.name ?? null);
          setPreviewUrl(file ? URL.createObjectURL(file) : null);
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-fuchsia-400/35 bg-fuchsia-500/10 text-lg font-semibold text-white transition hover:border-fuchsia-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500"
        aria-label={previewUrl ? "Cambiar foto seleccionada" : "Seleccionar foto de perfil"}
      >
        {initials}
        <Image
          src={previewUrl ?? "/student/perfil/avatar"}
          alt=""
          fill
          unoptimized
          className="object-cover"
        />
      </button>

      <div className="min-w-0">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition hover:border-fuchsia-500/35 hover:bg-white/[0.04]"
        >
          {previewUrl ? "Elegir otra foto" : "Cambiar foto"}
        </button>

        <div aria-live="polite" className="mt-1.5 min-h-5">
          {fileName ? (
            <p className="max-w-xs truncate text-xs text-zinc-400" title={fileName}>
              Vista previa lista · {fileName}
            </p>
          ) : (
            <p className="text-xs leading-5 text-zinc-500">JPG, PNG o WebP · máximo 5 MB</p>
          )}
        </div>
      </div>
    </div>
  );
}
