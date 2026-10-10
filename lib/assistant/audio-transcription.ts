import "server-only";
import {
  downloadMetaWhatsAppMedia,
  type MetaWhatsAppWebhookConfig,
  type MetaDownloadedMedia,
} from "./meta-whatsapp-channel";

export async function transcribeDemiAudio(input: {
  config: MetaWhatsAppWebhookConfig;
  mediaId: string;
}): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("audio_model_not_configured");
  const media = await downloadMetaWhatsAppMedia({ ...input, kind: "audio" });
  return transcribeDemiAudioBytes(media);
}

export async function transcribeDemiAudioBytes(
  media: Pick<MetaDownloadedMedia, "bytes"> & { mimeType: string },
): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("audio_model_not_configured");
  if (
    !["audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "audio/webm"].includes(media.mimeType) ||
    !media.bytes.length ||
    media.bytes.byteLength > 10 * 1024 * 1024
  )
    throw new Error("audio_media_invalid");
  // Meta may label an MP4/Opus recording as audio/ogg. Use the actual
  // container to choose the multipart filename; do not broaden accepted MIME types.
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...media.bytes.subarray(start, end));
  const mimeType =
    media.bytes.length >= 12 && ascii(4, 8) === "ftyp"
      ? "audio/mp4"
      : ascii(0, 4) === "OggS"
        ? "audio/ogg"
        : ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE"
          ? "audio/wav"
          : media.mimeType;
  const extension =
    mimeType === "audio/ogg"
      ? "ogg"
      : mimeType === "audio/mpeg"
        ? "mp3"
        : mimeType === "audio/mp4"
          ? "m4a"
          : mimeType === "audio/webm"
            ? "webm"
            : "wav";
  const form = new FormData();
  form.set("model", "gpt-4o-mini-transcribe");
  form.set("language", "es");
  form.set(
    "file",
    new Blob([new Uint8Array(media.bytes)], { type: mimeType }),
    `audio.${extension}`,
  );
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`audio_transcription_http_${response.status}`);
  const body = (await response.json()) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 8000) throw new Error("audio_transcription_unusable");
  return text;
}
