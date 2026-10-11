create table public.product_online_sale_events(
 id uuid primary key default gen_random_uuid(),studio_id uuid not null references public.studios(id),
 product_template_id uuid not null references public.product_templates(id),old_enabled boolean not null,new_enabled boolean not null,
 actor_user_id uuid not null references auth.users(id),created_at timestamptz not null default now());
create index product_online_sale_events_studio_idx on public.product_online_sale_events(studio_id,created_at desc);
create index product_online_sale_events_product_idx on public.product_online_sale_events(product_template_id);
create index product_online_sale_events_actor_idx on public.product_online_sale_events(actor_user_id);
alter table public.product_online_sale_events enable row level security;
grant select on public.product_online_sale_events to authenticated;
create policy product_online_sale_events_read on public.product_online_sale_events for select to authenticated using(private.has_capability(studio_id,'settings.write'));
create or replace function public.admin_set_product_online_purchasable(p_product_template_id uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
declare product public.product_templates%rowtype;
begin
 if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
 select * into product from public.product_templates where id=p_product_template_id for update;
 if not found then raise exception 'product_not_found'; end if;
 if not private.has_capability(product.studio_id,'settings.write') then raise exception 'forbidden'; end if;
 if p_enabled is null then raise exception 'enabled_required'; end if;
 if product.online_purchasable is not distinct from p_enabled then return; end if;
 update public.product_templates set online_purchasable=p_enabled,updated_at=now() where id=product.id;
 insert into public.product_online_sale_events(studio_id,product_template_id,old_enabled,new_enabled,actor_user_id)
 values(product.studio_id,product.id,product.online_purchasable,p_enabled,(select auth.uid()));
end; $$;
revoke all on function public.admin_set_product_online_purchasable(uuid,boolean) from public,anon;
grant execute on function public.admin_set_product_online_purchasable(uuid,boolean) to authenticated;
