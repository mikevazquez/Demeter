drop function if exists public.admin_assign_required_action(uuid,uuid);
drop function if exists public.admin_create_required_action(
  uuid,text,public.required_action_priority,uuid,text,uuid,uuid,uuid
);
drop function if exists public.admin_discard_required_action(uuid,text);
drop function if exists public.admin_resolve_required_action(uuid,text);
drop function if exists public.admin_take_required_action(uuid);
drop function if exists public.system_auto_close_required_action(uuid,text,text);
drop function if exists public.system_create_required_action(
  uuid,text,public.required_action_priority,uuid,text,uuid,uuid,uuid
);

drop function if exists private.create_required_action_internal(
  uuid,text,public.required_action_priority,uuid,text,uuid,uuid,uuid
);
drop function if exists private.transition_required_action_internal(uuid,text,uuid,text,text);
drop function if exists private.required_action_assert_scope(uuid,uuid,uuid,uuid);

drop trigger if exists required_action_audit_immutable on public.required_action_audit;
drop function if exists private.reject_required_action_audit_mutation();

drop table if exists public.required_action_audit;
drop table if exists public.required_actions;

delete from public.role_capabilities
where capability_key in ('required_actions.read','required_actions.manage');

delete from public.capabilities
where key in ('required_actions.read','required_actions.manage');

drop type if exists public.required_action_status;
drop type if exists public.required_action_priority;
