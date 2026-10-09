import { readFileSync, writeFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";
import ts from "typescript";

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) throw Error("Provide Meta Inbox source path and output path");
const source = readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const sandboxModule = { exports: {} };
const require = createRequire(import.meta.url);
runInNewContext(compiled, {
  module: sandboxModule,
  exports: sandboxModule.exports,
  require: (name) =>
    name === "server-only"
      ? {}
      : name === "./uat-scope"
        ? { demiUatScope: () => null }
        : require(name),
  Buffer,
  URL,
  fetch,
  AbortSignal,
  setTimeout,
  clearTimeout,
});
const api = sandboxModule.exports;
const results = [];
function test(variant, fn) {
  fn();
  results.push({ variant, passed: true });
}
const event = {
  sender: { id: "sender-uat" },
  recipient: { id: "page-uat" },
  timestamp: 1791550800000,
  message: { mid: "mid-uat", text: "Hola" },
};
const envelope = (value) => ({ object: "page", entry: [{ id: "page-uat", messaging: [value] }] });
test("facebook_extract_text_and_scoped_identity", () => {
  const [r] = api.extractMetaInboxMessages(envelope(event));
  assert.equal(r.provider, "facebook_messenger");
  assert.equal(r.providerContactId, "sender-uat");
  assert.equal(r.providerAccountId, "page-uat");
  assert.equal(r.text, "Hola");
});
test("facebook_ignore_echo", () =>
  assert.equal(
    api.extractMetaInboxMessages(
      envelope({ ...event, message: { ...event.message, is_echo: true } }),
    ).length,
    0,
  ));
test("facebook_ignore_page_as_sender", () =>
  assert.equal(
    api.extractMetaInboxMessages(envelope({ ...event, sender: { id: "page-uat" } })).length,
    0,
  ));
test("facebook_ignore_other_provider_envelope", () =>
  assert.equal(
    api.extractMetaInboxMessages({ object: "whatsapp_business_account", entry: [] }).length,
    0,
  ));
test("facebook_postback_preserves_title", () => {
  const [r] = api.extractMetaInboxMessages(
    envelope({
      ...event,
      message: undefined,
      postback: { mid: "postback-uat", title: "Ver clases" },
    }),
  );
  assert.equal(r.messageType, "postback");
  assert.equal(r.text, "Ver clases");
});
test("facebook_image_preserves_attachment_reference", () => {
  const [r] = api.extractMetaInboxMessages(
    envelope({
      ...event,
      message: {
        mid: "image-uat",
        attachments: [{ type: "image", payload: { url: "https://cdn.fbcdn.net/uat.png" } }],
      },
    }),
  );
  assert.equal(r.messageType, "attachment");
  assert.equal(r.attachmentUrl, "https://cdn.fbcdn.net/uat.png");
});
test("facebook_missing_id_generates_stable_event_reference", () => {
  const payload = envelope({ ...event, message: { text: "Hola" } });
  assert.equal(
    api.extractMetaInboxMessages(payload)[0].providerMessageId,
    api.extractMetaInboxMessages(payload)[0].providerMessageId,
  );
});
test("facebook_valid_hmac_accepted", () => {
  const raw = JSON.stringify(envelope(event));
  const signature = "sha256=" + createHmac("sha256", "uat-secret").update(raw).digest("hex");
  assert.equal(api.verifyMetaInboxWebhookSignature("uat-secret", raw, signature), true);
});
test("facebook_modified_body_rejects_signature", () => {
  const raw = JSON.stringify(envelope(event));
  const signature = "sha256=" + createHmac("sha256", "uat-secret").update(raw).digest("hex");
  assert.equal(api.verifyMetaInboxWebhookSignature("uat-secret", raw + " ", signature), false);
});
test("facebook_verify_token_compared_exactly", () => {
  assert.equal(api.verifyMetaInboxWebhookToken("uat-token", "uat-token"), true);
  assert.equal(api.verifyMetaInboxWebhookToken("uat-token", "wrong"), false);
});
writeFileSync(
  outputPath,
  JSON.stringify(
    { source_sha256: createHash("sha256").update(source).digest("hex"), results },
    null,
    2,
  ),
);
console.log(JSON.stringify({ passed: results.length, total: results.length }));
