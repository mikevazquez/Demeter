-- Hosted Supabase can grant service_role ALL through ALTER DEFAULT PRIVILEGES.
-- Explicitly remove those grants; only definer RPCs may mutate the coordination state.
revoke all on table public.assistant_whatsapp_turn_owners,
  public.assistant_whatsapp_send_claims, public.assistant_whatsapp_action_claims
  from service_role;
grant select on table public.assistant_whatsapp_turn_owners,
  public.assistant_whatsapp_send_claims, public.assistant_whatsapp_action_claims
  to service_role;
revoke all on sequence public.assistant_whatsapp_send_claims_id_seq from service_role;
