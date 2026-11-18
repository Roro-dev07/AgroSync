-- Run this file once in Supabase SQL Editor.
-- Saves a draft and its recipient snapshot in a single database transaction.
begin;

create or replace function public.agrosync_create_broadcast(
  p_region text, p_locality text, p_message text, p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_locality text := regexp_replace(btrim(p_locality), '\s+', ' ', 'g');
  v_message text := btrim(p_message);
  v_count integer;
  v_existing public.broadcasts%rowtype;
begin
  if auth.uid() is distinct from 'e7a38ce9-8104-4022-a137-8cca64113d2d'::uuid then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if p_request_id is null or p_region is null or btrim(p_region) = ''
     or v_locality is null or v_locality = '' or v_message is null or v_message = '' then
    raise exception 'Region, locality, message and request ID are required.';
  end if;

  insert into public.broadcasts (id, region, locality, message, status)
  values (p_request_id, p_region, v_locality, v_message, 'draft')
  on conflict (id) do nothing
  returning id into v_id;

  if v_id is null then
    select * into v_existing from public.broadcasts where id = p_request_id;
    if not found or v_existing.region is distinct from p_region
       or v_existing.locality is distinct from v_locality
       or v_existing.message is distinct from v_message then
      raise exception 'Request ID conflicts with another broadcast.';
    end if;
    select count(*) into v_count from public.broadcast_recipients where broadcast_id = p_request_id;
    if v_count = 0 then raise exception 'Existing draft has no recipients.'; end if;
    return jsonb_build_object('id', p_request_id, 'recipient_count', v_count);
  end if;

  insert into public.broadcast_recipients (broadcast_id, farmer_id, phone, status)
  select v_id, f.id, f.phone, 'pending'
  from public.farmers as f
  where lower(btrim(f.region)) = lower(btrim(p_region))
    and lower(regexp_replace(btrim(f.locality), '\s+', ' ', 'g')) = lower(v_locality);

  get diagnostics v_count = row_count;
  if v_count = 0 then
    -- Raising an exception rolls back BOTH the header and recipient inserts.
    raise exception 'No registered farmers in this locality.';
  end if;
  return jsonb_build_object('id', v_id, 'recipient_count', v_count);
end;
$$;

revoke all on function public.agrosync_create_broadcast(text, text, text, uuid) from public, anon;
grant execute on function public.agrosync_create_broadcast(text, text, text, uuid) to authenticated;

commit;

