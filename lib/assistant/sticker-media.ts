import "server-only";
import sharp from "sharp";
import { downloadMetaWhatsAppMedia, type MetaWhatsAppWebhookConfig } from "./meta-whatsapp-channel";

// Vision receives ordinary PNGs, never an animated WebP or an external media URL.
export async function stickerVisionFrames(bytes: Uint8Array): Promise<string[]> {
  if (!bytes.byteLength || bytes.byteLength > 1024 * 1024) throw new Error("sticker_size_invalid");
  const options = { limitInputPixels: 1024 * 1024, failOn: "warning" as const };
  const metadata = await sharp(bytes, options).metadata();
  if (metadata.format !== "webp") throw new Error("sticker_format_invalid");
  const pages = metadata.pages ?? 1;
  if (pages > 300) throw new Error("sticker_animation_too_long");
  const indices = [...new Set([0, Math.floor((pages - 1) / 2), pages - 1])];
  const frames: string[] = [];
  for (const page of indices) {
    const png = await sharp(bytes, { ...options, page, pages: 1 })
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .png()
      .toBuffer();
    frames.push(`data:image/png;base64,${png.toString("base64")}`);
  }
  return frames;
}

export async function loadDemiSticker(input: {
  config: MetaWhatsAppWebhookConfig;
  mediaId: string;
}) {
  const media = await downloadMetaWhatsAppMedia({ ...input, kind: "sticker" });
  return stickerVisionFrames(media.bytes);
}
