# Instagram Business Login — sandbox integration

Status: **not connected**, no Meta token obtained, no production changes authorized.

## Architecture
- Independent Meta app `Demeter-IG` (verify Meta App ID differs from WhatsApp app before changing app mode).
- Instagram Login scopes: `instagram_business_basic`, `instagram_business_manage_messages`. Comments only if the product needs them.
- Sandbox-only endpoint: `/api/integrations/instagram/webhook`.
- Environment variables: `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, `INSTAGRAM_APP_SECRET` (Instagram-specific secret for signature verification, not a WhatsApp secret).
- Webhook currently intentionally returns HTTP 503 for valid events until durable ingestion exists. **Do not subscribe real traffic yet**.
- Never commit access tokens, client secrets, or screenshots containing secrets.

## Remaining engineering work
1. Identify tenant/studio from the Instagram professional account ID and persist channel identity.
2. Implement idempotent webhook ingestion (event/message ID uniqueness), out-of-order handling, durable queue, retries, redacted logs.
3. Map inbound DM to CRM contact and conversation without overwriting WhatsApp identities.
4. Implement Instagram OAuth login, server-side code exchange, encrypted token storage, refresh, revocation and reconnect.
5. Implement outbound send with Meta Send API, eligibility/window checks and human handoff; Demi must obey Studio Flow booking/payment rules.
6. Build sandbox settings UI and channel-specific health diagnostics.
7. Deploy sandbox and set its public HTTPS callback in **the verified independent Instagram Meta app only**.
8. Resolve Meta access: avoid repeated Instagram tester invites that fail for business-owned apps; assess Business Login and required access level/App Review. Changing Meta app mode needs explicit user authorization after app-ID isolation.

## UAT matrix (none approved)
| ID | Case | Acceptance |
| --- | --- | --- |
| IG-01 | Meta authorization | OAuth succeeds for intended account and scopes |
| IG-02 | Webhook verification | correct challenge accepted; invalid token rejected |
| IG-03 | Signature security | invalid or missing signatures rejected |
| IG-04 | Inbound DM | persisted exactly once in correct tenant and conversation |
| IG-05 | Repeated/out-of-order event | no duplicates, no lost messages |
| IG-06 | Outbound reply | delivered to correct Instagram-scoped recipient |
| IG-07 | Demi business rules | no unauthorized bookings/payments; human escalation works |
| IG-08 | Token expired/revoked | actionable reconnect, no data leak |
| IG-09 | Isolation | WhatsApp/production behavior unchanged |
| IG-10 | Tenant isolation | messages cannot cross studios |

Promotion gate: every UAT explicitly approved **and** user says `autorizo promoción`.

## Reference
Meta Instagram API with Instagram Login: https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login
