"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createSMSService, settings, outcomes } = require("./broadcast-sms.cjs");
const { createAppServer } = require("./serve.cjs");
const ADMIN = "e7a38ce9-8104-4022-a137-8cca64113d2d", ID = "11111111-1111-4111-8111-111111111111";
const AUTH = "Bearer test-admin-token", NUMBER = "+233240000001";
const ENV = { AT_ENVIRONMENT: "live", AT_USERNAME: "agrosync_gh", AT_API_KEY: "TEST_SECRET_ONLY", AT_SENDER_ID: "AgroSync" };
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function harness({ numbers = [NUMBER], provider, env = ENV, user = ADMIN, failFinish = 0 } = {}) {
  const calls = [], ledger = new Map(numbers.map(n => [n, { status: "pending" }])); let serial = 0;
  const summary = () => {
    const counts = { total: ledger.size, pending: 0, processing: 0, accepted: 0, failed: 0, unknown: 0 };
    for (const row of ledger.values()) counts[row.status]++;
    return counts;
  };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/auth/v1/user")) return response({ id: user });
    if (url.includes("/rest/v1/rpc/")) {
      assert.equal(options.headers.Authorization, AUTH);
      const args = JSON.parse(options.body);
      if (url.endsWith("agrosync_sms_summary")) return response(summary());
      if (url.endsWith("agrosync_sms_claim")) {
        const claim = "claim-" + (++serial), recipients = [];
        for (const [number, row] of ledger) if (row.status === "pending" && recipients.length < 100) {
          row.status = "processing"; row.claim = claim; recipients.push(number);
        }
        return response({ ...summary(), claim_id: claim, recipients, message: "Rain & crops\nCheck drainage." });
      }
      if (url.endsWith("agrosync_sms_finish")) {
        if (failFinish-- > 0) throw Error("Simulated lost database response");
        for (const result of args.p_results) {
          const row = ledger.get(result.phone);
          if (row?.claim === args.p_claim_id && ["processing", "unknown"].includes(row.status)) Object.assign(row, result);
        }
        return response(summary());
      }
      throw Error("Unexpected database operation");
    }
    assert.match(url, /^https:\/\/api\.(sandbox\.)?africastalking\.com\/version1\/messaging$/);
    assert.equal(options.headers.apiKey, ENV.AT_API_KEY);
    const body = new URLSearchParams(options.body);
    assert.equal(body.get("message"), "Rain & crops\nCheck drainage.");
    assert.equal(body.get("username"), env.AT_USERNAME);
    assert.equal(body.get("bulkSMSMode"), "1");
    assert.equal(body.get("enqueue"), "1");
    if (provider) return provider(body);
    return response({ SMSMessageData: { Recipients: body.get("to").split(",").map(number =>
      ({ number, statusCode: 101, status: "Success", messageId: "AT-" + number })) } }, 201);
  };
  return { service: createSMSService({ env, fetchImpl }), calls, ledger, summary,
    providerCalls: () => calls.filter(call => call.url.includes("africastalking.com")) };
}
async function browserTest(configured, mode = "live") {
  class Element {
    constructor(value = "") { this.value = value; this.events = {}; this.disabled = false; this.dataset = {}; this.textContent = ""; }
    addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
    setAttribute() {} replaceChildren() {} appendChild() {} reportValidity() { return true; }
  }
  const region = new Element(), locality = new Element(), message = new Element(), status = new Element(), button = new Element();
  const form = new Element(); form.querySelector = selector => selector.includes("field-help") ? status : button;
  const nodes = { "broadcast-region": region, "broadcast-locality": locality, message };
  const document = { readyState: "loading", querySelector: () => form, getElementById: id => nodes[id],
    createElement: () => new Element(), events: {}, addEventListener(name, fn) { this.events[name] = fn; } };
  const requests = [], storage = new Map(); let submitted = 0;
  const context = vm.createContext({ document, console, setTimeout, clearTimeout, crypto: require("node:crypto").webcrypto,
    sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    window: { addEventListener() {}, location: { assign() {}, replace() {} } },
    AgroSyncBackend: { requireAdmin: async () => ({}), getClient: () => ({ auth: { onAuthStateChange() {} } }) },
    FarmerDB: { getRegions: () => ["Greater Accra"], getFarmersByLocality: async () => [1],
      getSMSStatus: async () => ({ ready: configured, mode, message: configured ? "SMS ready." : "Configure SMS." }),
      createBroadcastDraft: async input => { requests.push(input); return { id: input.requestId, recipientCount: 201 }; },
      sendBroadcast: async () => {
        submitted++; return { mode, accepted: Math.min(submitted * 100, 201), pending: Math.max(201 - submitted * 100, 0),
          failed: 0, unknown: 0, processing: 0, errors: [] };
      } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "broadcast.js"), "utf8"), context);
  await document.events.DOMContentLoaded();
  region.value = "Greater Accra"; locality.value = "Accra"; message.value = "Check drainage.";
  for (const submit of form.events.submit) await submit({ preventDefault() {} });
  assert.equal(submitted, configured ? 3 : 0);
  assert.equal(requests.length, 1); assert.equal(button.disabled, false); assert.equal(message.disabled, false);
  assert.match(status.textContent, configured ? /201 accepted/ : /No SMS was sent/);
  if (configured) {
    assert.match(status.textContent, /delivery is not yet confirmed/);
    if (mode === "android") {
      assert.match(status.textContent, /Android phone submission/);
      assert.doesNotMatch(status.textContent, /Africa's Talking/);
    }
    for (const submit of form.events.submit) await submit({ preventDefault() {} });
    assert.equal(requests[0].requestId, requests[1].requestId, "Retry must retain the draft ID");
    assert.ok(storage.has("agrosync.pendingBroadcast"));
  }
}
(async () => {
  const unauthorized = harness();
  await assert.rejects(unauthorized.service.send(undefined, ID), error => error.status === 401);
  assert.equal(unauthorized.calls.length, 0);
  const outsider = harness({ user: "another-user" });
  await assert.rejects(outsider.service.send(AUTH, ID), error => error.status === 403);
  assert.equal(outsider.providerCalls().length, 0);
  const invalid = harness();
  await assert.rejects(invalid.service.send(AUTH, "not-a-uuid"), error => error.status === 400);
  assert.equal(invalid.providerCalls().length, 0);
  const unconfigured = harness({ env: {} });
  assert.equal((await unconfigured.service.status(AUTH)).ready, false);
  await assert.rejects(unconfigured.service.send(AUTH, ID), /AT_ENVIRONMENT/);
  assert.equal(unconfigured.providerCalls().length, 0);
  assert.match(settings({ ...ENV, AT_SENDER_ID: "" }).problem, /approved/);
  assert.match(settings({ ...ENV, AT_USERNAME: "sandbox" }).problem, /Live/);
  console.log("PASS: administrator verification, invalid request rejection and configuration gating before any provider submission");

  const live = harness({ failFinish: 1 });
  assert.equal((await live.service.status(AUTH)).ready, true);
  const sent = await live.service.send(AUTH, ID);
  assert.equal(sent.accepted, 1); assert.equal(sent.failed, 0);
  assert.equal(live.providerCalls().length, 1);
  assert.equal(live.ledger.get(NUMBER).message_id, "AT-" + NUMBER);
  assert.equal(new URLSearchParams(live.providerCalls()[0].options.body).get("from"), "AgroSync");
  await live.service.send(AUTH, ID); assert.equal(live.providerCalls().length, 1);
  assert.ok(!JSON.stringify(sent).includes(ENV.AT_API_KEY));
  const sandbox = harness({ env: { ...ENV, AT_ENVIRONMENT: "sandbox", AT_USERNAME: "sandbox", AT_SENDER_ID: "" } });
  assert.equal((await sandbox.service.send(AUTH, ID)).mode, "sandbox");
  assert.match(sandbox.providerCalls()[0].url, /api\.sandbox\./);
  const timeout = harness({ provider: async () => { throw Error("Simulated provider timeout " + ENV.AT_API_KEY); } });
  assert.equal((await timeout.service.send(AUTH, ID)).unknown, 1);
  await timeout.service.send(AUTH, ID); assert.equal(timeout.providerCalls().length, 1);
  const noCredit = harness({ provider: async () => response({ SMSMessageData: { Recipients: [
    { number: NUMBER, statusCode: 405, status: "InsufficientBalance" }] } }, 201) });
  assert.equal((await noCredit.service.send(AUTH, ID)).failed, 1);
  await noCredit.service.send(AUTH, ID); assert.equal(noCredit.providerCalls().length, 1);
  assert.equal(outcomes([NUMBER], {}, 201)[0].status, "unknown");
  assert.equal(outcomes([NUMBER], { SMSMessageData: { Recipients: [null] } }, 201)[0].status, "unknown");
  assert.equal(outcomes([NUMBER], {}, 401)[0].status, "failed");
  assert.equal(outcomes([NUMBER], {}, 500)[0].status, "unknown");
  assert.equal(outcomes([NUMBER], { SMSMessageData: { Recipients: [{ number: NUMBER, statusCode: 101, messageId: "None" }] } }, 201)[0].status, "unknown");
  for (const code of [100, 101, 102]) assert.equal(outcomes([NUMBER], { SMSMessageData: { Recipients: [{ number: NUMBER, statusCode: code, messageId: "AT-ID" }] } }, 201)[0].status, "accepted");
  console.log("PASS: Live/Sandbox request encoding, provider IDs, database-only retry, no duplicate submissions, explicit rejection and uncertain timeout handling");

  const many = harness({ numbers: Array.from({ length: 205 }, (_, i) => "+23324" + String(i).padStart(7, "0")) });
  let result; do { result = await many.service.send(AUTH, ID); } while (result.pending);
  assert.equal(result.accepted, 205); assert.equal(many.providerCalls().length, 3);
  const concurrent = harness(); await Promise.all([concurrent.service.send(AUTH, ID), concurrent.service.send(AUTH, ID)]);
  assert.equal(concurrent.providerCalls().length, 1);
  await browserTest(true); await browserTest(false); await browserTest(true, "android");
  console.log("PASS: 205-recipient batching, concurrent claim isolation, browser status reporting, stable request IDs and draft-only fallback");

  const browserCalls = [];
  const clientContext = vm.createContext({ AbortSignal, console,
    LocalFarmerDB: { normalizeRegion: x => x, normalizePhone: x => x, normalizeLocality: x => x, getRegions: () => [] },
    AgroSyncBackend: { requireAdmin: async () => ({}), getClient: () => ({ auth: { getSession: async () =>
      ({ data: { session: { access_token: "test-admin-token" } } }) } }) },
    fetch: async (url, options) => { browserCalls.push({ url, options }); return response({ ready: true }); }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "serverDB.js"), "utf8"), clientContext);
  await vm.runInContext("FarmerDB.getSMSStatus()", clientContext);
  await vm.runInContext("FarmerDB.sendBroadcast('" + ID + "')", clientContext);
  assert.equal(browserCalls[0].options.method, "GET");
  assert.equal(browserCalls[1].options.method, "POST");
  assert.equal(browserCalls[1].options.headers.Authorization, AUTH);
  assert.deepEqual(JSON.parse(browserCalls[1].options.body), { broadcastId: ID });
  assert.ok(!JSON.stringify(browserCalls).includes(ENV.AT_API_KEY));
  console.log("PASS: browser database adapter forwards only the authenticated session and broadcast ID, never provider credentials");

  const server = createAppServer({ dashboard: { get: async () => ({ sources: { test: {} } }) }, sms: harness().service });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    assert.equal((await fetch(base + "/api/broadcast-sms")).status, 401);
    assert.equal((await fetch(base + "/api/broadcast-sms", { method: "POST", headers: { "Content-Type": "application/json", Authorization: AUTH }, body: "bad-json" })).status, 400);
    assert.equal((await fetch(base + "/api/broadcast-sms", { method: "POST", body: "x" })).status, 415);
    assert.equal((await fetch(base + "/api/broadcast-sms", { method: "POST", headers: { "Content-Type": "application/json", Authorization: AUTH }, body: JSON.stringify({ broadcastId: ID }) })).status, 200);
    for (const file of ["/.env", "/.env.example", "/broadcast-sms.cjs", "/supabase-sms.sql"]) assert.equal((await fetch(base + file)).status, 404);
    assert.equal((await fetch(base + "/broadcast.html")).status, 200);
    assert.equal((await fetch(base + "/api/dashboard?latitude=5.6&longitude=-0.2")).status, 200);
    assert.equal((await fetch(base + "/api/dashboard", { method: "POST" })).status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log("PASS: HTTP authentication, JSON validation, secret/server-file blocking, existing static pages and weather API");
  console.log("All SMS tests passed. No real SMS was sent.");
})().catch(error => { console.error(error); process.exitCode = 1; });
