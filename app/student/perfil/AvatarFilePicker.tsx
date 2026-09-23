"use client";

import { useId, useRef, useState } from "react";

export default function AvatarFilePicker() {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <div className="w-28 space-y-1.5">
      <input
        ref={inputRef}
        id={inputId}
        name="avatar"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        required
        className="sr-only"
        onChange={(event) => {
          setFileName(event.target.files?.[0]?.name ?? null);
        }}
      />

      <label
        htmlFor={inputId}
        className="inline-flex min-h-8 w-full cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/[0.035] px-2 py-1 text-[10px] font-semibold text-zinc-300 transition hover:border-fuchsia-500/35 hover:text-white"
      >
        Cargar foto
      </label>

      <div aria-live="polite" className="min-h-4">
        {fileName ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="block max-w-28 truncate text-left text-[10px] font-medium text-sky-400 underline decoration-sky-400/70 underline-offset-2 hover:text-sky-300"
            title={fileName}
            aria-label={`Cambiar foto seleccionada: ${fileName}`}
          >
            {fileName}
          </button>
        ) : (
          <p className="text-[9px] leading-4 text-zinc-500">JPG, PNG o WebP · máx. 5 MB</p>
        )}
      </div>
    </div>
  );
}
