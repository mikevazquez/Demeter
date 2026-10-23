import type { MetaTextDeliveryResult } from "./meta-whatsapp-channel";
import { demiDeliveryRetryPolicy } from "./delivery-retry-policy";
import { createHash } from "node:crypto";

export type ClaimRpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;

export type TextSendClaimResult =
  { status: "claimed"; token: string } | { status: "stale" } | { status: "unavailable" };

export async function claimDemiTextSend(
  rpc: ClaimRpc,
  studioId: string,
  eventId: string,
  token: string,
): Promise<TextSendClaimResult> {
  try {
    const result = await rpc("assistant_whatsapp_claim_current_text", {
      p_studio_id: studioId,
      p_event_id: eventId,
      p_claim_token: token,
    });
    if (result.error) return { status: "unavailable" };
    if (result.data === true) return { status: "claimed", token };
    if (result.data === false) return { status: "stale" };
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

export async function finishDemiTextSend(
  rpc: ClaimRpc,
  token: string,
  state: "accepted" | "uncertain" | "failed_final",
  providerMessageId?: string,
): Promise<boolean> {
  try {
    const result = await rpc("assistant_whatsapp_finish_text_claim", {
      p_claim_token: token,
      p_state: state,
      p_provider_message_id: providerMessageId ?? null,
    });
    return !result.error && result.data === true;
  } catch {
    return false;
  }
}

export class DemiCoordinationError extends Error {
  constructor(
    readonly outcome: string,
    readonly retryable = false,
  ) {
    super(outcome);
  }
}

type CoordinationState = {
  status: string;
  current_event_id?: string;
  burst_started_at?: string;
  last_text_at?: string;
};

// Canonical JSON ensures a model's argument-key ordering cannot bypass the action ledger.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export type DemiActionGuard = <T>(
  name: string,
  args: Record<string, unknown>,
  run: () => Promise<T>,
) => Promise<T>;

export class DemiTurnCoordinator {
  private lost = false;
  private heartbeat?: ReturnType<typeof setInterval>;
  readonly token = crypto.randomUUID();
  constructor(
    private rpc: ClaimRpc,
    readonly studioId: string,
    readonly eventId: string,
  ) {}

  private async state(operation: string): Promise<CoordinationState> {
    try {
      const result = await this.rpc("assistant_whatsapp_coordinate", {
        p_studio_id: this.studioId,
        p_event_id: this.eventId,
        p_token: this.token,
        p_operation: operation,
      });
      if (
        result.error ||
        !result.data ||
        typeof result.data !== "object" ||
        !("status" in result.data)
      )
        throw new Error();
      return result.data as CoordinationState;
    } catch {
      throw new DemiCoordinationError("turn_coordination_unavailable", true);
    }
  }

  async acquire() {
    const state = await this.state("acquire");
    if (state.status === "owned") {
      this.heartbeat = setInterval(() => {
        void this.state("renew")
          .then((s) => {
            if (!["current", "stale"].includes(s.status)) this.lost = true;
          })
          .catch(() => {
            this.lost = true;
          });
      }, 10_000);
      this.heartbeat.unref?.();
    }
    return state.status;
  }

  async current() {
    if (this.lost) return false;
    return (await this.state("current")).status === "current";
  }

  // Quiet time is an optimization. The SQL authorization remains authoritative.
  async waitForQuiet(
    quietMs: number,
    now = Date.now,
    wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {
    while (true) {
      const state = await this.state("current");
      if (state.status !== "current") return false;
      const last = Date.parse(state.last_text_at ?? "");
      const first = Date.parse(state.burst_started_at ?? "");
      if (!Number.isFinite(last) || !Number.isFinite(first)) return true;
      const remaining = Math.min(last + quietMs, first + 12_000) - now();
      if (remaining <= 0) return true;
      await wait(Math.min(remaining, 1_000));
    }
  }

  async authorizeSend() {
    if (this.lost) throw new DemiCoordinationError("turn_ownership_lost", true);
    const claim = await claimDemiTextSend(this.rpc, this.studioId, this.eventId, this.token);
    if (claim.status !== "claimed")
      throw new DemiCoordinationError(`text_claim_${claim.status}`, claim.status === "unavailable");
    const result = await this.rpc("assistant_whatsapp_authorize_text_send", {
      p_studio_id: this.studioId,
      p_event_id: this.eventId,
      p_claim_token: this.token,
    });
    if (result.error) throw new DemiCoordinationError("text_authorization_unavailable", true);
    if (result.data !== true) throw new DemiCoordinationError("text_authorization_stale", true);
  }

  async send(run: () => Promise<MetaTextDeliveryResult>) {
    await this.authorizeSend();
    let delivery: MetaTextDeliveryResult;
    try {
      delivery = await run();
    } catch {
      await this.finishSend("uncertain");
      throw new DemiCoordinationError("text_delivery_uncertain");
    }
    const state =
      delivery.status === "accepted"
        ? "accepted"
        : demiDeliveryRetryPolicy({
              errorCode: delivery.errorCode,
              retryable: delivery.retryable,
              attempt: 1,
              limit: 1,
            }).outcomeUnknown
          ? "uncertain"
          : "failed_final";
    if (
      !(await this.finishSend(
        state,
        delivery.status === "accepted" ? delivery.providerMessageId : undefined,
      ))
    ) {
      throw new DemiCoordinationError("text_result_requires_review");
    }
    return delivery;
  }

  async finishSend(state: "accepted" | "uncertain" | "failed_final", providerMessageId?: string) {
    // Repeating a receipt write is safe; repeating the provider request is not.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (await finishDemiTextSend(this.rpc, this.token, state, providerMessageId)) return true;
    }
    return false;
  }

  action: DemiActionGuard = async <T>(
    name: string,
    args: Record<string, unknown>,
    run: () => Promise<T>,
  ): Promise<T> => {
    if (this.lost) throw new DemiCoordinationError("turn_ownership_lost", true);
    const key = createHash("sha256").update(canonical({ name, args })).digest("hex");
    const params = {
      p_studio_id: this.studioId,
      p_event_id: this.eventId,
      p_token: this.token,
      p_action_key: key,
    };
    const claim = await this.rpc("assistant_whatsapp_claim_action", params);
    if (claim.error || !claim.data || typeof claim.data !== "object")
      throw new DemiCoordinationError("action_claim_unavailable", true);
    const data = claim.data as { status: string; result?: T };
    if (data.status === "completed") return data.result as T;
    if (data.status === "stale") throw new Error("assistant_turn_superseded");
    if (data.status !== "claimed")
      throw new DemiCoordinationError("action_outcome_requires_review");
    // Any thrown/ambiguous error leaves 'started' intact. Never replay it automatically.
    let result: T;
    try {
      result = await run();
    } catch {
      throw new DemiCoordinationError("action_outcome_requires_review");
    }
    if (result && typeof result === "object" && "error" in result)
      throw new DemiCoordinationError("action_outcome_requires_review");
    const finished = await this.rpc("assistant_whatsapp_finish_action", {
      ...params,
      p_result: result,
    });
    if (finished.error || finished.data !== true)
      throw new DemiCoordinationError("action_result_requires_review");
    return result;
  };

  async release() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    try {
      await this.state("release");
    } catch {
      /* The bounded lease provides recovery. */
    }
  }
}
