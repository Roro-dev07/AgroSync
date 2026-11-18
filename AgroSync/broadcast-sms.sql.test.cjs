/** Optional local PostgreSQL test engine; installed outside the app's dependencies. */
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { PGlite } = require(process.env.SMS_SQL_TEST_MODULE || path.join(os.tmpdir(), "agrosync-sms-tests/node_modules/@electric-sql/pglite"));
const ADMIN = "e7a38ce9-8104-4022-a137-8cca64113d2d", ID = "11111111-1111-4111-8111-111111111111";
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      grant usage on schema auth to anon, authenticated;
      create table public.broadcasts (id uuid primary key, message text, region text, locality text, status text);
      create table public.broadcast_recipients (broadcast_id uuid references public.broadcasts(id),
        phone text, status text default 'pending', unique(broadcast_id, phone));
      insert into public.broadcasts values ('${ID}', 'Check drainage.', 'Greater Accra', 'Test locality', 'draft');
      insert into public.broadcast_recipients (broadcast_id, phone)
        select '${ID}', '+23324' || lpad(g::text, 7, '0') from generate_series(1, 205) g;
    `);
    const migration = fs.readFileSync(path.join(__dirname, "supabase-sms.sql"), "utf8");
    await db.exec(migration); await db.exec(migration);
    await db.exec("set role anon");
    await assert.rejects(db.query("select public.agrosync_sms_claim($1, 'live')", [ID]), /permission denied/i);
    await db.exec("reset role; set role authenticated");
    await assert.rejects(db.query("select public.agrosync_sms_claim($1, 'live')", [ID]), /Administrator access required/);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ADMIN]);
    const claim = async (mode = "live") => (await db.query("select public.agrosync_sms_claim($1, $2) as data", [ID, mode])).rows[0].data;
    const summary = async () => (await db.query("select public.agrosync_sms_summary($1) as data", [ID])).rows[0].data;
    const batches = [await claim(), await claim(), await claim()];
    assert.deepEqual(batches.map(b => b.recipients.length), [100, 100, 5]);
    assert.equal(new Set(batches.flatMap(b => b.recipients)).size, 205);
    assert.equal((await claim()).recipients.length, 0);
    const results = batches[0].recipients.map((phone, i) => ({ phone, status: i === 0 ? "failed" : "accepted",
      message_id: i === 0 ? null : "AT-" + i, error_code: i === 0 ? "ProviderStatus405" : null }));
    const finish = async () => (await db.query("select public.agrosync_sms_finish($1, $2, $3::jsonb) as data",
      [ID, batches[0].claim_id, JSON.stringify(results)])).rows[0].data;
    assert.equal((await finish()).accepted, 99); assert.equal((await finish()).accepted, 99);
    assert.equal((await summary()).failed, 1);
    await assert.rejects(claim("sandbox"), /changed environment or content/);
    await assert.rejects(db.query("update public.broadcast_sms_deliveries set status = 'pending'"), /permission denied/);
    await db.exec("reset role; update public.broadcast_sms_deliveries set updated_at = now() - interval '10 minutes' where status = 'processing'; set role authenticated");
    const aged = await claim();
    assert.equal(aged.unknown, 105); assert.equal(aged.recipients.length, 0);
    assert.equal(aged.accepted, 99); assert.equal(aged.failed, 1); assert.equal(aged.pending, 0);
    // Upgrade an old live/sandbox constraint while preserving prior submission data.
    await db.exec("reset role; alter table public.broadcast_sms_jobs drop constraint broadcast_sms_jobs_environment_check; " +
      "alter table public.broadcast_sms_jobs add constraint broadcast_sms_jobs_environment_check check (environment in ('live', 'sandbox'))");
    await db.exec(migration);
    assert.equal((await summary()).accepted, 99);
    const phoneId = "33333333-3333-4333-8333-333333333333";
    await db.query("insert into public.broadcasts values ($1, 'Phone gateway test', 'Greater Accra', 'Test locality', 'draft')", [phoneId]);
    await db.query("insert into public.broadcast_recipients (broadcast_id, phone) values ($1, '+233240000001')", [phoneId]);
    await db.exec("set role authenticated");
    const phoneClaim = (await db.query("select public.agrosync_sms_claim($1, 'android') as data", [phoneId])).rows[0].data;
    assert.equal(phoneClaim.schema_version, 2); assert.equal(phoneClaim.recipients.length, 1);
    await assert.rejects(db.query("select public.agrosync_sms_claim($1, 'live')", [phoneId]), /changed environment or content/);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", ["22222222-2222-4222-8222-222222222222"]);
    assert.equal((await db.query("select * from public.broadcast_sms_deliveries")).rows.length, 0);
    await assert.rejects(summary(), /Administrator access required/);
    console.log("PASS: PostgreSQL migration runs twice, admin-only functions, RLS isolation, immutable environment, unique 100/100/5 batches, idempotent results and uncertain-claim protection");
    console.log("PASS: upgrading the old environment constraint preserves existing submissions and enables an isolated Android job");
    console.log("All SMS SQL tests passed. This local database used synthetic recipients; your Supabase project was not changed.");
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
