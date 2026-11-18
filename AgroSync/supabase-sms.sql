-- Run AFTER supabase-broadcast.sql in the Supabase SQL Editor.
-- Keeps SMS submission results separate from the original recipient snapshot.
begin;

create table if not exists public.broadcast_sms_jobs (
  broadcast_id uuid primary key references public.broadcasts(id),
  environment text not null check (environment in ('live', 'sandbox', 'android')),
  message text not null,
  created_at timestamptz not null default now()
);
-- Upgrade an already-installed version without deleting jobs or delivery records.
alter table public.broadcast_sms_jobs drop constraint if exists broadcast_sms_jobs_environment_check;
alter table public.broadcast_sms_jobs add constraint broadcast_sms_jobs_environment_check
  check (environment in ('live', 'sandbox', 'android'));
create table if not exists public.broadcast_sms_deliveries (
  broadcast_id uuid not null references public.broadcast_sms_jobs(broadcast_id),
  phone text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'accepted', 'failed', 'unknown')),
  claim_id uuid,
  provider_message_id text,
  error_code text,
  updated_at timestamptz not null default now(),
  primary key (broadcast_id, phone)
);
alter table public.broadcast_sms_jobs enable row level security;
alter table public.broadcast_sms_deliveries enable row level security;
revoke all on public.broadcast_sms_jobs, public.broadcast_sms_deliveries from public, anon, authenticated;
grant select on public.broadcast_sms_jobs, public.broadcast_sms_deliveries to authenticated;
drop policy if exists sms_admin_read on public.broadcast_sms_jobs;
create policy sms_admin_read on public.broadcast_sms_jobs for select to authenticated
  using (auth.uid() = 'e7a38ce9-8104-4022-a137-8cca64113d2d'::uuid);
drop policy if exists sms_admin_read on public.broadcast_sms_deliveries;
create policy sms_admin_read on public.broadcast_sms_deliveries for select to authenticated
  using (auth.uid() = 'e7a38ce9-8104-4022-a137-8cca64113d2d'::uuid);

create or replace function public.agrosync_sms_summary(p_broadcast_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_summary jsonb;
begin
  if auth.uid() is distinct from 'e7a38ce9-8104-4022-a137-8cca64113d2d'::uuid then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'schema_version', 2,
    'total', count(*),
    'pending', count(*) filter (where status = 'pending'),
    'processing', count(*) filter (where status = 'processing'),
    'accepted', count(*) filter (where status = 'accepted'),
    'failed', count(*) filter (where status = 'failed'),
    'unknown', count(*) filter (where status = 'unknown')
  ) into v_summary from public.broadcast_sms_deliveries where broadcast_id = p_broadcast_id;
  return v_summary;
end;
$$;

create or replace function public.agrosync_sms_claim(p_broadcast_id uuid, p_environment text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_message text;
  v_job public.broadcast_sms_jobs%rowtype;
  v_claim uuid := gen_random_uuid();
  v_recipients jsonb;
begin
  if auth.uid() is distinct from 'e7a38ce9-8104-4022-a137-8cca64113d2d'::uuid then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if p_environment is null or p_environment not in ('live', 'sandbox', 'android') then
    raise exception 'Invalid SMS environment.';
  end if;
  -- Lock the header to serialize claims for this broadcast across server processes.
  select message into v_message from public.broadcasts where id = p_broadcast_id for update;
  if not found then raise exception 'Broadcast not found.'; end if;
  if v_message is null or btrim(v_message) = '' or char_length(v_message) > 1600 then
    raise exception 'SMS message must contain 1 to 1600 characters.';
  end if;
  select * into v_job from public.broadcast_sms_jobs where broadcast_id = p_broadcast_id;
  if not found then
    if exists (select 1 from public.broadcast_recipients
      where broadcast_id = p_broadcast_id and status is distinct from 'pending') then
      raise exception 'This draft already has delivery activity. Review it before sending.';
    end if;
    insert into public.broadcast_sms_jobs (broadcast_id, environment, message)
      values (p_broadcast_id, p_environment, v_message);
    insert into public.broadcast_sms_deliveries (broadcast_id, phone)
      select p_broadcast_id, phone from public.broadcast_recipients
      where broadcast_id = p_broadcast_id group by phone;
    if not found then raise exception 'No registered recipients in this draft.'; end if;
  elsif v_job.environment <> p_environment or v_job.message <> v_message then
    raise exception 'This broadcast changed environment or content. Create a new draft.';
  end if;
  -- A timeout/crash may have happened AFTER the provider accepted the request.
  -- Never automatically reclaim those recipients and risk duplicate SMS charges.
  update public.broadcast_sms_deliveries set status = 'unknown', error_code = 'InterruptedSubmission', updated_at = now()
    where broadcast_id = p_broadcast_id and status = 'processing' and updated_at < now() - interval '5 minutes';
  with next_batch as (
    select phone from public.broadcast_sms_deliveries
    where broadcast_id = p_broadcast_id and status = 'pending' order by phone limit 100 for update
  )
  update public.broadcast_sms_deliveries d set status = 'processing', claim_id = v_claim, updated_at = now()
    from next_batch b where d.broadcast_id = p_broadcast_id and d.phone = b.phone;
  select coalesce(jsonb_agg(phone order by phone), '[]'::jsonb) into v_recipients
    from public.broadcast_sms_deliveries where broadcast_id = p_broadcast_id and claim_id = v_claim;
  return public.agrosync_sms_summary(p_broadcast_id) || jsonb_build_object(
    'claim_id', v_claim, 'recipients', v_recipients, 'message', v_message);
end;
$$;

create or replace function public.agrosync_sms_finish(p_broadcast_id uuid, p_claim_id uuid, p_results jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is distinct from 'e7a38ce9-8104-4022-a137-8cca64113d2d'::uuid then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results) > 100 then
    raise exception 'Invalid SMS results.';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_results) as r(phone text, status text)
      where r.phone is null or r.status is null or r.status not in ('accepted', 'failed', 'unknown')) then
    raise exception 'Invalid SMS result status.';
  end if;
  update public.broadcast_sms_deliveries d
    set status = r.status, provider_message_id = left(r.message_id, 300),
        error_code = left(r.error_code, 100), updated_at = now()
    from jsonb_to_recordset(p_results) as r(phone text, status text, message_id text, error_code text)
    where d.broadcast_id = p_broadcast_id and d.claim_id = p_claim_id and d.phone = r.phone
      and d.status in ('processing', 'unknown');
  return public.agrosync_sms_summary(p_broadcast_id);
end;
$$;

revoke all on function public.agrosync_sms_summary(uuid), public.agrosync_sms_claim(uuid, text),
  public.agrosync_sms_finish(uuid, uuid, jsonb) from public, anon;
grant execute on function public.agrosync_sms_summary(uuid), public.agrosync_sms_claim(uuid, text),
  public.agrosync_sms_finish(uuid, uuid, jsonb) to authenticated;
commit;
