export type TextSendClaimResult =
  | { status: "claimed"; token: string }
  | { status: "stale" }
  | { status: "unavailable" };

type ClaimRpc = (
  name: string,
  args: Record<string, string>,
) => PromiseLike<{ data: unknown; error: unknown }>;

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
): Promise<boolean> {
  try {
    const result = await rpc("assistant_whatsapp_finish_text_claim", {
      p_claim_token: token,
      p_state: state,
    });
    return !result.error && result.data === true;
  } catch {
    return false;
  }
}
