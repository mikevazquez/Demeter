create table public.demi_first_class_payment_links (
 studio_id uuid not null references public.studios(id),
 class_template_id uuid not null references public.class_templates(id),
 checkout_url text not null check(checkout_url ~ '^https://((www\.)?mercadopago\.com\.mx/[^[:space:]#]+|mpago\.la/[A-Za-z0-9_-]+)$'),
 amount_minor integer not null check(amount_minor>0),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 enabled boolean not null default true,
 updated_by uuid not null,
 updated_at timestamptz not null default clock_timestamp(),
 primary key(studio_id,class_template_id)
);
alter table public.demi_first_class_payment_links enable row level security;
revoke all on public.demi_first_class_payment_links from anon,authenticated;
grant select on public.demi_first_class_payment_links to authenticated;
grant all on public.demi_first_class_payment_links to service_role;
create policy demi_first_class_payment_links_admin_read on public.demi_first_class_payment_links for select to authenticated using(private.has_capability(studio_id,'settings.write'));

create function public.admin_save_demi_first_class_payment_link(p_studio uuid,p_template uuid,p_url text,p_amount integer,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare price integer; curr text;
begin
 if auth.uid() is null or not private.has_capability(p_studio,'settings.write') then raise exception 'forbidden'; end if;
 select ct.drop_in_price_minor,st.currency into price,curr from public.class_templates ct join public.studios st on st.id=ct.studio_id where ct.id=p_template and ct.studio_id=p_studio;
 if not found then raise exception 'class_not_found'; end if;
 if trim(coalesce(p_url,''))='' then delete from public.demi_first_class_payment_links where studio_id=p_studio and class_template_id=p_template;return jsonb_build_object('ok',true,'enabled',false); end if;
 if p_url !~ '^https://((www\.)?mercadopago\.com\.mx/[^[:space:]#]+|mpago\.la/[A-Za-z0-9_-]+)$' then raise exception 'checkout_url_invalid'; end if;
 if coalesce(price,0)<=0 or p_amount is distinct from price then raise exception 'checkout_price_mismatch'; end if;
 insert into public.demi_first_class_payment_links(studio_id,class_template_id,checkout_url,amount_minor,currency,enabled,updated_by)
 values(p_studio,p_template,p_url,price,upper(curr),coalesce(p_enabled,false),auth.uid())
 on conflict(studio_id,class_template_id) do update set checkout_url=excluded.checkout_url,amount_minor=excluded.amount_minor,currency=excluded.currency,enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 return jsonb_build_object('ok',true,'enabled',coalesce(p_enabled,false));
end; $$;
revoke all on function public.admin_save_demi_first_class_payment_link(uuid,uuid,text,integer,boolean) from public,anon;
grant execute on function public.admin_save_demi_first_class_payment_link(uuid,uuid,text,integer,boolean) to authenticated;

create function public.service_get_demi_first_class_payment_options(p_studio uuid,p_session uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare link public.demi_first_class_payment_links%rowtype; price integer; curr text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select ct.drop_in_price_minor,st.currency into price,curr from public.class_sessions cs join public.class_templates ct on ct.id=cs.template_id and ct.studio_id=cs.studio_id join public.studios st on st.id=cs.studio_id where cs.id=p_session and cs.studio_id=p_studio and cs.status='scheduled';
 if not found then return jsonb_build_object('ok',false,'reason_code','session_not_found'); end if;
 select l.* into link from public.demi_first_class_payment_links l join public.class_sessions cs on cs.template_id=l.class_template_id and cs.studio_id=l.studio_id where cs.id=p_session and cs.studio_id=p_studio and l.enabled and l.amount_minor=price and l.currency=upper(curr);
 return jsonb_build_object('ok',true,'external_checkout',case when found then jsonb_build_object('provider','mercado_pago','url',link.checkout_url,'amount_minor',link.amount_minor,'currency',link.currency,'receipt_required',true,'test_only',exists(select 1 from public.demi_uat_runs where studio_id=p_studio)) else null end);
end; $$;
revoke all on function public.service_get_demi_first_class_payment_options(uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_get_demi_first_class_payment_options(uuid,uuid) to service_role;
