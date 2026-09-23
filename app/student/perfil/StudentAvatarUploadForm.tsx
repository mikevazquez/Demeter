"use client";

import { useEffect, useRef, useState } from "react";

import PendingActionButton from "../components/PendingActionButton";

type StudentAvatarUploadFormProps = {
  action: (formData: FormData) => void | Promise<void>;
};

export default function StudentAvatarUploadForm({ action }: StudentAvatarUploadFormProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  function handleFileChange(file: File | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);

    const nextPreviewUrl = file ? URL.createObjectURL(file) : null;
    previewUrlRef.current = nextPreviewUrl;
    setSelectedFile(file);
    setPreviewUrl(nextPreviewUrl);
  }

  return (
    <form action={action} className="mt-2 space-y-2">
      <input
        id="student-profile-avatar"
        name="avatar"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        required
        className="sr-only"
        onChange={(event) => handleFileChange(event.currentTarget.files?.[0] ?? null)}
      />

      <label
        htmlFor="student-profile-avatar"
        className="inline-flex min-h-8 cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-semibold text-zinc-300 transition hover:border-fuchsia-500/35 hover:text-white"
      >
        Cargar foto
      </label>

      {selectedFile && previewUrl ? (
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          className="block max-w-44 truncate text-[11px] font-medium text-sky-400 underline decoration-sky-400/60 underline-offset-2"
          title={selectedFile.name}
        >
          {selectedFile.name}
        </a>
      ) : (
        <p className="text-[9px] text-zinc-600">JPG, PNG o WebP · máximo 5 MB</p>
      )}

      <PendingActionButton
        pendingLabel="Guardando…"
        disabled={!selectedFile}
        className="min-h-8 w-full rounded-lg border border-white/10 px-2 py-1 text-[10px] font-semibold text-zinc-300 transition hover:border-fuchsia-500/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
      >
        Guardar foto
      </PendingActionButton>
    </form>
  );
}
