# Demi / Studio Flow Assistant — Phase 1 architecture

- Status: Proposed for Sandbox implementation
- Date: 2026-09-30
- Branch: `feat/demi-sandbox-01`
- Scope: Sandbox only
- Production: explicitly out of scope until separate authorization
- Pilot tenant: Demeter Fitness Studio
- Product architecture: multi-tenant from day one

## 1. Goal

Build a Studio Flow-owned conversational assistant layer in which:

1. WhatsApp or the internal demo UI are channels only.
2. OpenAI interprets natural language, carries conversational language context and drafts responses.
3. Studio Flow remains the source of truth for schedules, availability, packages, credits, prices, payments, reservations, policies, promotions and student state.
4. The model never receives unrestricted database access.
5. Every business read/write happens through a controlled Studio Flow tool.
6. Existing Asistian behavior remains available while Demi is developed and evaluated.

The first demonstrable target is an internal Sandbox chat that can answer a question such as “¿Hay pole mañana después de las 6?” from real Sandbox data and, after explicit confirmation, create the correct Sandbox reservation.

## 2. Existing platform pieces to reuse

The current codebase already provides useful seams:

- Generic messaging-provider abstraction and persisted delivery attempts.
- Asistian outbound provider.
- Signed Asistian inbound webhook with deduplication.
- Domain events with studio scope, deduplication keys, correlation and causation.
- Booking engine and booking/cancellation/waitlist RPCs.
- `crm_conversations` and conversation-to-booking attribution.
- Meta WhatsApp outbound template adapter.
- Per-studio WhatsApp provider selection.
- A Sandbox Meta inbound receiver that validates Meta signatures and audits inbound payloads.

Do not replace these systems. Demi should sit above the domain layer and call the same booking/commercial rules used by the rest of Studio Flow.

## 3. Architectural boundary

```text
                 ┌──────────────────────────┐
                 │ Channel                  │
                 │ Demo UI / WhatsApp       │
                 └────────────┬─────────────┘
                              │ normalized inbound message
                              ▼
                 ┌──────────────────────────┐
                 │ Assistant Gateway        │
                 │ tenant + identity + mode │
                 └────────────┬─────────────┘
                              │
                              ▼
                 ┌──────────────────────────┐
                 │ Demi Orchestrator        │
                 │ OpenAI Responses API     │
                 │ no direct DB access      │
                 └───────┬─────────┬────────┘
                         │         │
                 tool request      │ final reply
                         │         │
                         ▼         │
                 ┌──────────────────────────┐
                 │ Studio Flow Tool Layer   │
                 │ authz / validation       │
                 │ confirmation / idempot.  │
                 │ tenant isolation / audit │
                 └────────────┬─────────────┘
                              │
                              ▼
                 ┌──────────────────────────┐
                 │ Existing domain services │
                 │ booking/commercial/etc.  │
                 └────────────┬─────────────┘
                              │
                              ▼
                 ┌──────────────────────────┐
                 │ Supabase / domain events │
                 │ source of truth          │
                 └──────────────────────────┘
```

The model never receives a Supabase key, service-role key, database URL, Meta token, OpenAI key or raw SQL capability.

## 4. Tenant isolation

Tenant identity must be resolved by trusted server context, never by a model argument.

- Internal demo: tenant comes from the authenticated Studio Flow admin context.
- WhatsApp: tenant is resolved from Meta `phone_number_id` to a configured Studio Flow channel connection.
- Tools do not accept `studio_id` in their public model schema.
- Every tool executor receives trusted `studioId` from the gateway and applies it to every query/RPC.
- Server authorization is rechecked even if the model was only shown allowed tools.
- Cross-tenant references fail closed.

The current Sandbox Meta receiver hardcodes Demeter’s studio ID. That is acceptable only as historical pilot code; it must not become the Demi multi-tenant implementation.

## 5. Conversation ownership and context

Studio Flow owns the durable conversation state.

For the first implementation use OpenAI Responses API with `store: false`. Do not depend on OpenAI Conversations as Studio Flow’s canonical memory.

Why:

- Studio Flow can enforce its own retention policy.
- Operational context can be refreshed from tools instead of becoming stale model memory.
- PII can be minimized before each model call.
- The application can switch model/provider later without losing conversation continuity.
- OpenAI conversation objects have different retention semantics than ordinary non-stored Responses.

Persist only the conversational information needed to resume the interaction:

- current topic/intention;
- referenced activity;
- referenced day/time window;
- selected session reference;
- pending action reference;
- whether explicit user confirmation is still required;
- last few sanitized user/assistant turns or a compact conversation summary;
- linked CRM/student opaque reference when known.

Never persist business facts such as “3 credits remaining” as conversation truth. Re-query them when needed.

## 6. OpenAI API design

Use the Responses API and function/tool calling.

Tool definitions:

- JSON Schema;
- `strict: true`;
- `additionalProperties: false`;
- all properties required, nullable where logically optional;
- short, precise descriptions;
- no raw SQL or generic query tool.

Initial orchestrator setting:

- `parallel_tool_calls: false` for the first UAT implementation.
- Tool allow-list selected server-side per phase, tenant and conversation.
- Mutating calls require an action token generated by Studio Flow.
- The model cannot mint or alter action tokens.

Model selection must stay configurable per tenant/environment. Initial evaluation set:

- GPT-5.6 Luna: cost-sensitive baseline.
- GPT-5.6 Terra: comparison model for difficult/ambiguous conversations.
- GPT-5.6 Sol: not the default; use only if eval evidence justifies its higher cost.

No model promotion decision is final until conversational UAT compares correctness, tool selection, confirmation discipline, latency and cost.

Official references reviewed 2026-09-30:

- https://developers.openai.com/api/docs/guides/function-calling
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/conversation-state
- https://developers.openai.com/api/docs/guides/your-data
- https://developers.openai.com/api/docs/guides/safety-best-practices

## 7. Controlled tool catalog

Tool names are product contracts, not direct table/RPC names.

### Read tools — permission A

`search_class_availability`
- Finds real sessions using activity/date/time filters.
- Returns opaque session references, display time, activity, capacity status and relevant eligibility hints.
- Never invents a session when no match exists.

`get_activity_catalog`
- Returns active disciplines/activities and customer-facing descriptions.

`get_commercial_options`
- Returns approved prices, packages, memberships and currently active promotions.
- Values are read from Studio Flow at request time.

`get_studio_information`
- Location, contact instructions, what-to-bring guidance and other configured customer-facing business information.

`get_policy_information`
- Cancellation, late cancellation, no-show, recovery, enrollment and other configured policies.

`identify_contact`
- Server-side contact matching using channel identity.
- Returns an opaque contact/student reference and minimal identity state.
- The model should not receive phone/email unless needed to clarify identity.

`get_student_summary`
- Minimal authorized student state: relationship status, active-package state, remaining credits, package expiry, payment state relevant to the request.
- No full student record.

`get_pending_action`
- Returns the server-owned action awaiting confirmation, if any.

### Prepare/confirm tools — permission B

Each sensitive customer action uses a two-step server-enforced flow.

`prepare_booking`
`execute_booking`

`prepare_cancellation`
`execute_cancellation`

`prepare_reschedule`
`execute_reschedule`

`prepare_waitlist_join`
`execute_waitlist_join`

Prepare tools validate the request and return:

- human-readable summary;
- expected consequences;
- any policy outcome;
- short-lived opaque `action_token`;
- expiry;
- required confirmation wording/category.

Execution tools require that exact token and a server-recorded explicit confirmation turn. They revalidate the underlying domain state immediately before mutation.

This prevents the model from bypassing confirmation simply by deciding that the user “probably meant yes”.

### Automatic operational tools — permission A

`ensure_prospect`
- May create/link the minimum CRM prospect/contact record required to track an inbound conversation.
- Must be idempotent.

`escalate_to_human`
- Creates a human-attention item with reason and sanitized context.
- Does not grant privileges to the model.

### Explicitly unavailable to the model — permission C

No callable model tools for:

- grant/gift credits;
- alter a payment;
- mark a payment paid without the normal payment process;
- change prices;
- invent or apply an unapproved discount;
- modify policies;
- modify package configuration;
- administrative overrides;
- manual attendance corrections;
- user/role administration;
- tenant configuration changes;
- secrets or integration credentials.

Such requests return an escalation path.

## 8. Tool execution contract

Every tool execution must include server-owned metadata:

- `studio_id`;
- `assistant_conversation_id`;
- `turn_id`;
- `tool_call_id`;
- tool name + schema version;
- permission class A/B/C;
- actor/contact reference;
- correlation ID;
- idempotency key when applicable;
- requested arguments after validation;
- status;
- domain entity IDs affected;
- sanitized result;
- duration;
- error code;
- timestamps.

For mutations, idempotency is mandatory. A retry must not create a second booking/cancellation/waitlist entry.

Prefer existing domain RPCs/services. Do not reproduce booking eligibility, credit consumption, cancellation policy or waitlist rules in the assistant layer.

## 9. Proposed additive persistence

Do not overload Asistian-specific event tables.

Add generic assistant tables in Sandbox:

`assistant_configs`
- one configuration per studio;
- assistant name, active mode, model, reasoning effort, tone/instructions, budget limits, escalation rules.

`assistant_conversations`
- studio, channel, external channel reference, optional CRM/student link, status, structured context, last activity.

`assistant_turns`
- inbound/outbound sanitized text, channel message reference, timestamps, model-call link.

`assistant_model_calls`
- model, API response ID when useful, latency, input/cached/output/reasoning tokens, estimated cost, status/error.

`assistant_tool_executions`
- immutable tool request/result/action audit.

`assistant_pending_actions`
- short-lived confirmation tokens bound to tenant + conversation + exact action + target.

`assistant_budget_periods` or an equivalent aggregate/view
- monthly usage and enforceable limits.

All public-schema tables must have RLS. Service-role-only helpers must not be exposed to browser clients.

## 10. Privacy and PII minimization

Default policy:

- Send user message text because it is necessary to understand intent.
- Replace tenant/database UUIDs with opaque tool references where possible.
- Do not send email, full phone, date of birth, documents, payment details or full profile unless a specific tool requires a minimal subset.
- Use first name only for natural replies when available.
- Tool results return purpose-built DTOs, not raw rows.
- Secrets remain server-side.
- Use `store: false` for OpenAI calls in the initial demo.
- Logs redact configured sensitive fields.
- Do not place untrusted inbound text into developer/system instructions.
- Treat tool outputs and external text as data, never instructions.

## 11. Cost instrumentation

Record actual usage returned by the API for every model call.

Required metrics:

- model;
- number of API calls;
- input tokens;
- cached input tokens when supplied;
- output tokens;
- reasoning tokens when supplied;
- estimated USD cost;
- estimated MXN cost using a recorded conversion rate if shown in product UI;
- conversation total;
- tenant monthly total;
- latency;
- tool calls per turn.

Pricing must be versioned/configured with `effective_at`; never hardcode a forever-price.

API prices observed on 2026-09-30 model documentation, per 1M text tokens:

| Model | Input | Cached input | Output |
| --- | ---: | ---: | ---: |
| GPT-5.6 Luna | $0.20 | $0.02 | $1.20 |
| GPT-5.6 Terra | $2.00 | $0.20 | $12.00 |
| GPT-5.6 Sol | $4.00 | $0.40 | $20.00 |

The cost engine must use the model actually returned/selected and a dated price row.

Budget guards:

- soft warning threshold;
- hard monthly tenant limit;
- optional per-conversation ceiling;
- maximum model calls per user turn;
- maximum tool loop depth;
- fallback/escalation when the hard limit is reached.

## 12. Asistian + Demi coexistence

Do not make both systems answer the same end user independently.

Use explicit per-studio mode:

- `off`: Demi disabled.
- `demo`: internal UI only.
- `shadow`: inbound copied to Demi for evaluation; no customer reply and no mutations.
- `pilot`: Demi may answer only allowlisted contacts/test conversations.
- `active`: Demi owns allowed conversations; Asistian remains configured as rollback/fallback until retirement is explicitly approved.

The current Asistian receiver and outbound integration remain intact throughout Phase 1–4.

## 13. Meta WhatsApp receiver status

Sandbox currently contains `receive-meta-whatsapp-webhook`.

Observed behavior:

- verifies the Meta webhook verification token on GET;
- verifies `x-hub-signature-256` on POST;
- audits inbound message/status payloads;
- currently hardcodes Demeter studio ID;
- currently replies with a notification-only redirect message at most once per 24h per sender;
- is not wired into CRM/Demi;
- current Sandbox audit table contains zero inbound Meta events at the time of this review.

Therefore inbound Meta connectivity is considered **implemented but not end-to-end validated with a real inbound message**.

Do not modify this receiver for the Phase 2 internal demo. Direct WhatsApp work belongs to Phase 5.

## 14. Phase acceptance gates

### Phase 1 complete when

- architecture and threat boundaries are documented;
- current reusable components are mapped;
- model/API strategy is documented from current OpenAI docs;
- tool contracts and permission classes are defined;
- data/cost/audit model is defined;
- implementation branch is isolated from Production.

### Phase 2 demo gate

Internal Sandbox chat must:

1. use real Sandbox schedule data;
2. answer availability questions correctly;
3. retain conversational references such as “¿y a las 8?”;
4. prepare a reservation;
5. require explicit confirmation;
6. create exactly one real Sandbox reservation using existing booking rules;
7. show the tool/audit trace;
8. show token/cost/latency information;
9. never access Production.

## 15. Non-negotiable invariants

- Production is not modified.
- No merge/promotion to Production without explicit authorization.
- Asistian is not disconnected or deleted.
- The model never receives direct unrestricted DB access.
- The model never invents operational truth.
- Tenant ID is never trusted from model input.
- Business mutations are idempotent.
- User-impacting actions in permission B require server-enforced confirmation.
- Administrative exceptions remain human-only.
