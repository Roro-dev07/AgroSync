-- Run after supabase-broadcast.sql (and supabase-sms.sql if SMS is installed).
-- Additive migration: existing farmers are NOT assumed to have opted in.
begin;
alter table public.farmers add column if not exists whatsapp_opt_in boolean not null default false;
alter table public.farmers add column if not exists whatsapp_consent_at timestamptz;
alter table public.farmers add column if not exists whatsapp_opt_out_at timestamptz;

create or replace function public.agrosync_whatsapp_consent_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' and new.phone is distinct from old.phone then
    new.whatsapp_opt_in := false;
    new.whatsapp_consent_at := null;
    new.whatsapp_opt_out_at := now();
  elsif new.whatsapp_opt_in then
    if TG_OP = 'INSERT' then
      new.whatsapp_consent_at := now(); new.whatsapp_opt_out_at := null;
    elsif not old.whatsapp_opt_in then
      new.whatsapp_consent_at := now(); new.whatsapp_opt_out_at := null;
    else
      new.whatsapp_consent_at := old.whatsapp_consent_at;
      new.whatsapp_opt_out_at := old.whatsapp_opt_out_at;
    end if;
  else
    if TG_OP = 'INSERT' then
      new.whatsapp_consent_at := null; new.whatsapp_opt_out_at := null;
    else
      new.whatsapp_consent_at := old.whatsapp_consent_at;
      new.whatsapp_opt_out_at := case when old.whatsapp_opt_in then now() else old.whatsapp_opt_out_at end;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists agrosync_whatsapp_consent on public.farmers;
create trigger agrosync_whatsapp_consent before insert or update on public.farmers
  for each row execute function public.agrosync_whatsapp_consent_stamp();

create table if not exists public.broadcast_whatsapp_jobs (
  broadcast_id uuid primary key references public.broadcasts(id),
  sender_id text not null, template_name text not null, language text not null,
  message text not null, locality text not null, created_at timestamptz not null default now()
);
create table if not exists public.broadcast_whatsapp_deliveries (
  broadcast_id uuid not null references public.broadcast_whatsapp_jobs(broadcast_id),
  phone text not null,
  status text not null default 'pending' check(status in
    ('pending','processing','accepted','sent','delivered','read','failed','unknown','skipped')),
  claim_id uuid, provider_message_id text unique, error_code text,
  status_at timestamptz, updated_at timestamptz not null default now(),
  primary key(broadcast_id,phone)
);
alter table public.broadcast_whatsapp_jobs enable row level security;
alter table public.broadcast_whatsapp_deliveries enable row level security;
revoke all on public.broadcast_whatsapp_jobs, public.broadcast_whatsapp_deliveries from public, anon, authenticated;
grant select on public.broadcast_whatsapp_jobs, public.broadcast_whatsapp_deliveries to authenticated;
drop policy if exists whatsapp_admin_read on public.broadcast_whatsapp_jobs;
create policy whatsapp_admin_read on public.broadcast_whatsapp_jobs for select to authenticated
  using(auth.uid() = 'e7a38ce9-8104-4022-a137-8cca64113d2d'::uuid);
drop policy if exists whatsapp_admin_read on public.broadcast_whatsapp_deliveries;
create policy whatsapp_admin_read on public.broadcast_whatsapp_deliveries for select to authenticated
  using(auth.uid() = 'e7a38ce9-8104-4022-a137-8cca64113d2d'::uuid);

create or replace function public.agrosync_whatsapp_preview(p_broadcast_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_message text; v_locality text;
begin
  if auth.uid() is distinct from 'e7a38ce9-8104-4022-a137-8cca64113d2d'::uuid then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  select message, locality into v_message, v_locality from public.broadcasts where id=p_broadcast_id;
  if not found then raise exception 'Broadcast not found.'; end if;
  if v_message is null or btrim(v_message)='' or char_length(v_message)>1600
     or v_locality is null or btrim(v_locality)='' then raise exception 'Invalid WhatsApp broadcast.'; end if;
  return jsonb_build_object('message',v_message,'locality',v_locality);
end;
$$;
create or replace function public.agrosync_whatsapp_summary(p_broadcast_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is distinct from 'e7a38ce9-8104-4022-a137-8cca64113d2d'::uuid then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  select jsonb_build_object('schema_version',1,'total',count(*),
    'pending',count(*) filter(where status='pending'), 'processing',count(*) filter(where status='processing'),
    'accepted',count(*) filter(where status='accepted'), 'sent',count(*) filter(where status='sent'),
    'delivered',count(*) filter(where status='delivered'), 'read',count(*) filter(where status='read'),
    'failed',count(*) filter(where status='failed'), 'unknown',count(*) filter(where status='unknown'),
    'skipped',count(*) filter(where status='skipped')) into v_result
    from public.broadcast_whatsapp_deliveries where broadcast_id=p_broadcast_id;
  return v_result;
end;
$$;
create or replace function public.agrosync_whatsapp_claim(
  p_broadcast_id uuid,p_sender_id text,p_template text,p_language text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_header jsonb; v_job public.broadcast_whatsapp_jobs%rowtype;
  v_claim uuid := gen_random_uuid(); v_recipients jsonb; v_has_sms boolean;
begin
  if auth.uid() is distinct from 'e7a38ce9-8104-4022-a137-8cca64113d2d'::uuid then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if p_sender_id is null or p_sender_id !~ '^[0-9]{5,30}$' or p_template is null
    or p_template !~ '^[a-z][a-z0-9_]*$' or length(p_template)>512 or p_language is null
    or p_language !~ '^[a-z]{2,3}(_[A-Z]{2})?$' then raise exception 'Invalid WhatsApp configuration.'; end if;
  perform 1 from public.broadcasts where id=p_broadcast_id for update;
  v_header := public.agrosync_whatsapp_preview(p_broadcast_id);
  select * into v_job from public.broadcast_whatsapp_jobs where broadcast_id=p_broadcast_id;
  if not found then
    if exists(select 1 from public.broadcast_recipients where broadcast_id=p_broadcast_id and status is distinct from 'pending') then
      raise exception 'This draft already has delivery activity. Create a new broadcast.';
    end if;
    -- SMS and WhatsApp jobs use separate tracking; never reuse an existing SMS job.
    if to_regclass('public.broadcast_sms_jobs') is not null then
      execute 'select exists(select 1 from public.broadcast_sms_jobs where broadcast_id=$1)' into v_has_sms using p_broadcast_id;
      if v_has_sms then raise exception 'This draft already has an SMS job. Create a new broadcast.'; end if;
    end if;
    insert into public.broadcast_whatsapp_jobs(broadcast_id,sender_id,template_name,language,message,locality)
      values(p_broadcast_id,p_sender_id,p_template,p_language,v_header->>'message',v_header->>'locality');
    insert into public.broadcast_whatsapp_deliveries(broadcast_id,phone,status,error_code)
      select p_broadcast_id,r.phone,
        case when coalesce(bool_or(f.whatsapp_opt_in and f.whatsapp_consent_at is not null),false) then 'pending' else 'skipped' end,
        case when coalesce(bool_or(f.whatsapp_opt_in and f.whatsapp_consent_at is not null),false) then null else 'WhatsAppConsentMissing' end
      from public.broadcast_recipients r left join public.farmers f on f.id=r.farmer_id and f.phone=r.phone
      where r.broadcast_id=p_broadcast_id group by r.phone;
    if not found then raise exception 'No registered recipients in this draft.'; end if;
  elsif v_job.sender_id is distinct from p_sender_id or v_job.template_name is distinct from p_template
    or v_job.language is distinct from p_language or v_job.message is distinct from v_header->>'message'
    or v_job.locality is distinct from v_header->>'locality' then
    raise exception 'This WhatsApp broadcast changed configuration or content. Create a new draft.';
  end if;
  update public.broadcast_whatsapp_deliveries d set status='skipped',error_code='WhatsAppConsentWithdrawn',updated_at=now()
    where broadcast_id=p_broadcast_id and status='pending' and not exists(
      select 1 from public.broadcast_recipients r join public.farmers f on f.id=r.farmer_id and f.phone=r.phone
      where r.broadcast_id=p_broadcast_id and r.phone=d.phone and f.whatsapp_opt_in and f.whatsapp_consent_at is not null);
  update public.broadcast_whatsapp_deliveries set status='unknown',error_code='InterruptedWhatsAppSubmission',updated_at=now()
    where broadcast_id=p_broadcast_id and status='processing' and updated_at<now()-interval '5 minutes';
  with batch as(select phone from public.broadcast_whatsapp_deliveries
    where broadcast_id=p_broadcast_id and status='pending' order by phone limit 10 for update)
  update public.broadcast_whatsapp_deliveries d set status='processing',claim_id=v_claim,updated_at=now()
    from batch b where d.broadcast_id=p_broadcast_id and d.phone=b.phone;
  select coalesce(jsonb_agg(phone order by phone),'[]'::jsonb) into v_recipients
    from public.broadcast_whatsapp_deliveries where broadcast_id=p_broadcast_id and claim_id=v_claim;
  return public.agrosync_whatsapp_summary(p_broadcast_id)||v_header||
    jsonb_build_object('claim_id',v_claim,'recipients',v_recipients);
end;
$$;
create or replace function public.agrosync_whatsapp_finish(p_broadcast_id uuid,p_claim_id uuid,p_results jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is distinct from 'e7a38ce9-8104-4022-a137-8cca64113d2d'::uuid then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results)>10 then raise exception 'Invalid WhatsApp results.'; end if;
  if exists(select 1 from jsonb_to_recordset(p_results) as r(phone text,status text,message_id text)
    where r.phone is null or r.status is null or r.status not in ('accepted','failed','unknown')
      or (r.status='accepted' and (r.message_id is null or length(r.message_id)>300))) then raise exception 'Invalid WhatsApp result status.'; end if;
  update public.broadcast_whatsapp_deliveries d set
    status=case when d.status in ('processing','unknown') then r.status else d.status end,
    provider_message_id=coalesce(d.provider_message_id,left(r.message_id,300)),
    error_code=case when d.status in ('processing','unknown') then left(r.error_code,100) else d.error_code end,updated_at=now()
    from jsonb_to_recordset(p_results) as r(phone text,status text,message_id text,error_code text)
    where d.broadcast_id=p_broadcast_id and d.claim_id=p_claim_id and d.phone=r.phone;
  return public.agrosync_whatsapp_summary(p_broadcast_id);
end;
$$;

-- Only the signed-webhook server uses this function, with its private service-role key.
create or replace function public.agrosync_whatsapp_events(p_sender_id text,p_events jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e record; v_at timestamptz; v_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Webhook server access required.' using errcode='42501'; end if;
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events)>100 then raise exception 'Invalid webhook events.'; end if;
  for e in select * from jsonb_to_recordset(p_events) as r(kind text,phone text,message_id text,status text,
      timestamp bigint,broadcast_id uuid,claim_id uuid,error_code text) loop
    if e.phone is null or e.phone !~ '^\+233[235][0-9]{8}$' then continue; end if;
    if e.kind='optout' then
      update public.farmers set whatsapp_opt_in=false where phone=e.phone and whatsapp_opt_in;
      update public.broadcast_whatsapp_deliveries set status='skipped',error_code='WhatsAppConsentWithdrawn',updated_at=now()
        where phone=e.phone and status='pending';
    elsif e.kind='status' and e.status in ('sent','delivered','read','failed') and e.message_id is not null
       and length(e.message_id)<=300 and e.timestamp>0 then
      v_at := to_timestamp(e.timestamp);
      update public.broadcast_whatsapp_deliveries d set status=e.status,
        provider_message_id=e.message_id,error_code=case when e.status='failed' then left(e.error_code,100) else null end,
        status_at=v_at,updated_at=now()
        from public.broadcast_whatsapp_jobs j where j.broadcast_id=d.broadcast_id and j.sender_id=p_sender_id and d.phone=e.phone
        and (d.provider_message_id=e.message_id or (d.provider_message_id is null and d.broadcast_id=e.broadcast_id and d.claim_id=e.claim_id))
        and d.status in ('processing','unknown','accepted','sent','delivered','read','failed')
        and (e.status='read' or (e.status='delivered' and d.status<>'read')
          or (e.status in ('sent','failed') and d.status not in ('delivered','read') and (d.status_at is null or v_at>d.status_at)));
      get diagnostics v_count = row_count;
    end if;
  end loop;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.agrosync_whatsapp_preview(uuid),public.agrosync_whatsapp_summary(uuid),
  public.agrosync_whatsapp_claim(uuid,text,text,text),public.agrosync_whatsapp_finish(uuid,uuid,jsonb) from public,anon;
grant execute on function public.agrosync_whatsapp_preview(uuid),public.agrosync_whatsapp_summary(uuid),
  public.agrosync_whatsapp_claim(uuid,text,text,text),public.agrosync_whatsapp_finish(uuid,uuid,jsonb) to authenticated;
revoke all on function public.agrosync_whatsapp_events(text,jsonb) from public,anon,authenticated;
grant execute on function public.agrosync_whatsapp_events(text,jsonb) to service_role;
commit;
