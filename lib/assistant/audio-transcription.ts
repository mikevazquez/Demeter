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
  const extension =
    media.mimeType === "audio/ogg"
      ? "ogg"
      : media.mimeType === "audio/mpeg"
        ? "mp3"
        : media.mimeType === "audio/mp4"
          ? "m4a"
          : media.mimeType === "audio/webm"
            ? "webm"
            : "wav";
  const form = new FormData();
  form.set("model", "gpt-4o-mini-transcribe");
  form.set("language", "es");
  form.set(
    "file",
    new Blob([new Uint8Array(media.bytes)], { type: media.mimeType }),
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
