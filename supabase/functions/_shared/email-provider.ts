export type EmailConnection = {
  provider: "resend" | "sendgrid" | "ses";
  from_email: string;
  secret: string;
  region?: string;
};
const bytes = (value: string) => new TextEncoder().encode(value);
const hex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (n) => n.toString(16).padStart(2, "0")).join("");
const digest = async (value: string) => hex(await crypto.subtle.digest("SHA-256", bytes(value)));
async function hmac(key: Uint8Array, value: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, bytes(value)));
}
export async function sendProviderEmail(
  connection: EmailConnection,
  to: string,
  subject: string,
  text: string,
  idempotencyKey?: string,
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let endpoint: string;
  let payload: unknown;
  if (connection.provider === "resend") {
    endpoint = "https://api.resend.com/emails";
    headers.Authorization = `Bearer ${connection.secret}`;
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    payload = { from: connection.from_email, to: [to], subject, text };
  } else if (connection.provider === "sendgrid") {
    endpoint = "https://api.sendgrid.com/v3/mail/send";
    headers.Authorization = `Bearer ${connection.secret}`;
    payload = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: connection.from_email },
      subject,
      content: [{ type: "text/plain", value: text }],
    };
  } else {
    const credentials = JSON.parse(connection.secret) as {
      accessKeyId: string;
      secretAccessKey: string;
    };
    const region = connection.region ?? "us-east-1";
    if (!/^[a-z]{2}-[a-z]+-\d$/.test(region)) throw new Error("email_region_invalid");
    endpoint = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
    payload = {
      FromEmailAddress: connection.from_email,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: { Text: { Data: text, Charset: "UTF-8" } },
        },
      },
    };
    const body = JSON.stringify(payload);
    const time = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const day = time.slice(0, 8);
    const host = new URL(endpoint).host;
    headers["X-Amz-Date"] = time;
    const canonical = `POST\n/v2/email/outbound-emails\n\ncontent-type:application/json\nhost:${host}\nx-amz-date:${time}\n\ncontent-type;host;x-amz-date\n${await digest(body)}`;
    const scope = `${day}/${region}/ses/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${time}\n${scope}\n${await digest(canonical)}`;
    const signingKey = await hmac(
      await hmac(
        await hmac(await hmac(bytes(`AWS4${credentials.secretAccessKey}`), day), region),
        "ses",
      ),
      "aws4_request",
    );
    const signature = hex((await hmac(signingKey, stringToSign)).buffer as ArrayBuffer);
    headers.Authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=content-type;host;x-amz-date, Signature=${signature}`;
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const responseText = await response.text();
  let result: Record<string, unknown> = {};
  try {
    result = JSON.parse(responseText);
  } catch {}
  return {
    ok: response.ok,
    status: response.status,
    messageId: String(result.id ?? result.MessageId ?? response.headers.get("x-message-id") ?? ""),
  };
}
