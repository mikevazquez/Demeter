import { afterEach, describe, expect, it, vi } from "vitest";
import { sendProviderEmail } from "../supabase/functions/_shared/email-provider";

afterEach(() => vi.unstubAllGlobals());
describe("Connected email provider transport", () => {
  it("sends Resend idempotently and keeps provider responses out of the result", async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "mail-1", recipient: "private" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", transport);
    const result = await sendProviderEmail(
      { provider: "resend", from_email: "from@example.test", secret: "synthetic" },
      "to@example.test",
      "Título",
      "Mensaje",
      "delivery-1",
    );
    expect(result).toEqual({ ok: true, status: 200, messageId: "mail-1" });
    expect(transport.mock.calls[0][1].headers["Idempotency-Key"]).toBe("delivery-1");
    expect(JSON.parse(transport.mock.calls[0][1].body).to).toEqual(["to@example.test"]);
  });
  it("does not claim a rejected send succeeded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 })),
    );
    expect(
      await sendProviderEmail(
        { provider: "resend", from_email: "from@example.test", secret: "synthetic" },
        "to@example.test",
        "Título",
        "Mensaje",
      ),
    ).toEqual({ ok: false, status: 401, messageId: "" });
  });
  it("reads SendGrid acceptance from the response header", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 202, headers: { "x-message-id": "grid-1" } }),
        ),
    );
    expect(
      await sendProviderEmail(
        { provider: "sendgrid", from_email: "from@example.test", secret: "synthetic" },
        "to@example.test",
        "Título",
        "Mensaje",
      ),
    ).toEqual({ ok: true, status: 202, messageId: "grid-1" });
  });
  it("rejects an unsafe AWS region before making a request", async () => {
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    await expect(
      sendProviderEmail(
        {
          provider: "ses",
          region: "us-east-1.attacker.test",
          from_email: "from@example.test",
          secret: JSON.stringify({ accessKeyId: "synthetic", secretAccessKey: "synthetic" }),
        },
        "to@example.test",
        "Título",
        "Mensaje",
      ),
    ).rejects.toThrow("email_region_invalid");
    expect(transport).not.toHaveBeenCalled();
  });
  it("signs an SES request without transmitting the secret access key", async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ MessageId: "ses-1" }), { status: 200 }));
    vi.stubGlobal("fetch", transport);
    await sendProviderEmail(
      {
        provider: "ses",
        region: "us-east-1",
        from_email: "from@example.test",
        secret: JSON.stringify({
          accessKeyId: "AKIA_SYNTHETIC",
          secretAccessKey: "synthetic-secret",
        }),
      },
      "to@example.test",
      "Título",
      "Mensaje",
    );
    expect(transport.mock.calls[0][0]).toBe(
      "https://email.us-east-1.amazonaws.com/v2/email/outbound-emails",
    );
    expect(transport.mock.calls[0][1].headers.Authorization).toMatch(
      /AWS4-HMAC-SHA256 Credential=AKIA_SYNTHETIC.*Signature=[a-f0-9]{64}$/,
    );
    expect(JSON.stringify(transport.mock.calls[0])).not.toContain("synthetic-secret");
  });
});
