# Governance 2.0 · Worker Dispatch Pilot

This increment implements the smallest provider-agnostic layer needed for GOV-AGENTS-001 PILOT-01.

## Scope

- Canonical worker states: `available`, `busy`, `degraded`, `no_capacity`, `disconnected`.
- Agent Registry validation.
- Capacity Gate with either registry state or an injected live probe.
- Eligibility checks for capabilities, permissions, quality floor and risk tier.
- Dispatcher selection that evaluates sufficiency first and resource cost last.
- Deterministic evidence explaining why each worker was accepted or rejected.

It does not connect a new provider, invoke a remote model, deploy anything, or grant production permissions.

## Pilot flow

The test task `GOV-PILOT-01` is a Tier 3 engineering task requiring code, Git, tests, repository write access and Sandbox access.

With both workers available, Codex wins because the registry gives it the stronger engineering fit.

When the Capacity Gate observes:

```json
{
  "worker": "codex",
  "state": "no_capacity"
}
```

Codex becomes ineligible and the same `taskId` is dispatched to Cloud if Cloud still satisfies the same quality floor, permissions and risk limits.

The decision therefore represents:

```text
GOV-PILOT-01
  -> capacity gate
  -> codex: no_capacity
  -> recalculate eligible workers
  -> cloud: eligible
  -> assigned to cloud
```

## Quality rule

Cost never makes an otherwise insufficient worker eligible.

Selection order after mandatory eligibility is:

1. specialty fit;
2. existing context;
3. quality;
4. relative resource cost;
5. stable worker ID tie-break.

This preserves the Governance rule: optimize consumption only after the quality and safety floor is met.

## Capacity evidence

The module intentionally separates two sources:

- registry state, such as a user-reported temporary `no_capacity`;
- live `capacityProbe` observation.

A real autonomous Codex quota detector is not claimed by this increment. PILOT-01 can prove the routing contract with a deterministic probe, while a later adapter can replace that probe with a verifiable CLI/API/event signal without changing the dispatcher.

## Safety

- No production access is added.
- No secrets are read or stored.
- No model API key is introduced.
- No automatic retry can bypass `no_capacity`.
- A worker missing permissions, quality or risk eligibility is blocked even if it is cheaper.
