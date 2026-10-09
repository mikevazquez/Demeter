import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function matchesSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const supplied = signature.slice(7);
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = createHmac("sha256", secret).update(body, "utf8").digest();
  return timingSafeEqual(expected, Buffer.from(supplied, "hex"));
}

export async function GET(request: NextRequest) {
  const verifyToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
  if (!verifyToken) return new NextResponse("Webhook not configured", { status: 503 });
  const params = request.nextUrl.searchParams;
  if (
    params.get("hub.mode") !== "subscribe" ||
    params.get("hub.verify_token") !== verifyToken ||
    !params.has("hub.challenge")
  ) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return new NextResponse(params.get("hub.challenge"), {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request: NextRequest) {
  const secret = process.env.INSTAGRAM_APP_SECRET;
  if (!secret) return new NextResponse("Webhook not configured", { status: 503 });
  const rawBody = await request.text();
  if (!matchesSignature(rawBody, request.headers.get("x-hub-signature-256"), secret)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || (payload as {object?: unknown}).object !== "instagram") {
    return new NextResponse("Unexpected webhook object", { status: 400 });
  }
  // Safe scaffolding only: do not acknowledge delivery as processed until
  // durable ingestion, deduplication and tenant routing are implemented.
  return new NextResponse("Instagram ingestion not enabled", { status: 503 });
}
