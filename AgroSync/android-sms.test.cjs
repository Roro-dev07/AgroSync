"use strict";
const assert = require("node:assert/strict");
const { androidSettings, androidOutcomes, submitAndroid, checkAndroid } = require("./android-sms.cjs");
const { createSMSService, settings } = require("./broadcast-sms.cjs");
const NUMBER = "+233240000001", SECOND = "+233240000002";
const ADMIN = "e7a38ce9-8104-4022-a137-8cca64113d2d", ID = "11111111-1111-4111-8111-111111111111";
const AUTH = "Bearer test-admin-token";
const ENV = { SMS_PROVIDER: "android", SMS_GATEWAY_URL: "http://192.168.1.20:8080",
  SMS_GATEWAY_USERNAME: "phone-user", SMS_GATEWAY_PASSWORD: "test-phone-secret", SMS_GATEWAY_SIM: "2",
  AT_API_KEY: "unused-old-provider-secret" };
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function fixture({ provider, health = 200, schema = 2 } = {}) {
  let state = "pending", providerCalls = 0; const calls = [];
  const counts = () => ({ schema_version: schema, total: 1, pending: +(state === "pending"), processing: +(state === "processing"),
    accepted: +(state === "accepted"), failed: +(state === "failed"), unknown: +(state === "unknown") });
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    assert.ok(!url.includes("africastalking"), "Android mode must not contact Africa's Talking");
    if (url.endsWith("/auth/v1/user")) return reply({ id: ADMIN });
    if (url.includes("/rest/v1/rpc/")) {
      const args = JSON.parse(options.body);
      if (url.endsWith("agrosync_sms_summary")) return reply(counts());
      if (url.endsWith("agrosync_sms_claim")) {
        assert.equal(args.p_environment, "android");
        const recipients = state === "pending" ? [NUMBER] : []; if (recipients.length) state = "processing";
        return reply({ ...counts(), claim_id: ID, message: "Check drainage & soil moisture.", recipients });
      }
      if (url.endsWith("agrosync_sms_finish")) { state = args.p_results[0].status; return reply(counts()); }
      throw Error("Unexpected database call");
    }
    assert.equal(options.headers.Authorization, "Basic " + Buffer.from("phone-user:test-phone-secret").toString("base64"));
    assert.equal(options.redirect, "error");
    if (url.endsWith("/health")) return reply({}, health);
    assert.equal(url, ENV.SMS_GATEWAY_URL + "/message"); providerCalls++;
    const body = JSON.parse(options.body);
    assert.deepEqual(body.phoneNumbers, [NUMBER]); assert.equal(body.textMessage.text, "Check drainage & soil moisture.");
    assert.equal(body.id, ID); assert.equal(body.simNumber, 2); assert.equal(body.priority, 0);
    assert.equal(body.ttl, 3600); assert.equal(body.withDeliveryReport, true);
    assert.ok(!("from" in body)); assert.ok(!("apiKey" in options.headers));
    if (provider) return provider(body);
    return reply({ id: ID, state: "Pending", recipients: [{ phoneNumber: NUMBER, state: "Pending" }] }, 202);
  };
  return { service: createSMSService({ env: ENV, fetchImpl }), calls, providerCalls: () => providerCalls };
}
(async () => {
  assert.equal(settings(ENV).problem, "");
  assert.equal(settings(ENV).mode, "android");
  assert.equal(androidSettings({ ...ENV, SMS_GATEWAY_USERNAME: "" }).problem, "", "An intentionally empty Basic username is allowed");
  for (const url of ["https://example.com", "http://8.8.8.8:8080", "file:///etc/passwd", "http://user:password@192.168.1.1:8080",
    "http://192.168.1.1:8080/message", "http://192.168.1.1:8080?x=1", "http://localhost:8080", ""]) {
    assert.match(androidSettings({ ...ENV, SMS_GATEWAY_URL: url }).problem, /local address/);
  }
  for (const url of ["http://10.0.0.2:8080", "http://172.16.0.2:8080", "http://192.168.1.20:8080", "http://127.0.0.1:8080"]) {
    assert.equal(androidSettings({ ...ENV, SMS_GATEWAY_URL: url }).problem, "");
  }
  assert.match(androidSettings({ ...ENV, SMS_GATEWAY_PASSWORD: "" }).problem, /password/);
  assert.match(androidSettings({ ...ENV, SMS_GATEWAY_SIM: "4" }).problem, /SIM/);
  console.log("PASS: Android configuration requires no sender ID or Africa's Talking key, restricts gateway URLs to local IPs and validates SIM selection");
  const gateway = fixture(); const status = await gateway.service.status(AUTH);
  assert.equal(status.ready, true); assert.match(status.message, /SIM/);
  assert.ok(!JSON.stringify(status).includes(ENV.SMS_GATEWAY_PASSWORD));
  const sent = await gateway.service.send(AUTH, ID);
  assert.equal(sent.accepted, 1); assert.equal(sent.mode, "android");
  await gateway.service.send(AUTH, ID); assert.equal(gateway.providerCalls(), 1);
  assert.ok(!JSON.stringify(sent).includes(ENV.SMS_GATEWAY_PASSWORD));
  const oldSchema = fixture({ schema: 1 });
  assert.match((await oldSchema.service.status(AUTH)).message, /updated supabase-sms.sql/);
  assert.equal(oldSchema.providerCalls(), 0);
  assert.equal((await fixture({ health: 401 }).service.status(AUTH)).ready, false);
  assert.equal((await fixture({ health: 503 }).service.status(AUTH)).ready, false);
  console.log("PASS: authenticated readiness, schema-version check, Basic authentication, JSON request, queue acceptance and duplicate-send prevention");
  const timeout = fixture({ provider: async () => { throw Error("Simulated local timeout"); } });
  assert.equal((await timeout.service.send(AUTH, ID)).unknown, 1);
  await timeout.service.send(AUTH, ID); assert.equal(timeout.providerCalls(), 1);
  for (const state of ["Pending", "Processed", "Sent", "Delivered"]) {
    assert.equal(androidOutcomes([NUMBER], { id: ID, recipients: [{ phoneNumber: NUMBER, state }] }, 202)[0].status, "accepted");
  }
  for (const state of ["Failed", "Cancelled"]) {
    assert.equal(androidOutcomes([NUMBER], { id: ID, recipients: [{ phoneNumber: NUMBER, state }] }, 202)[0].status, "failed");
  }
  assert.equal(androidOutcomes([NUMBER], { id: ID, recipients: [{ phoneNumber: SECOND, state: "Pending" }] }, 202)[0].status, "unknown");
  assert.equal(androidOutcomes([NUMBER], { recipients: [{ phoneNumber: NUMBER, state: "Pending" }] }, 202)[0].status, "unknown");
  assert.equal(androidOutcomes([NUMBER], {}, 500)[0].status, "unknown");
  assert.equal(androidOutcomes([NUMBER], {}, 409)[0].status, "unknown");
  assert.equal(androidOutcomes([NUMBER], {}, 401)[0].status, "failed");
  assert.equal(androidOutcomes([NUMBER], { id: ID, recipients: [null] }, 202)[0].status, "unknown");
  const mixed = androidOutcomes([NUMBER, SECOND], { id: ID, recipients: [
    { phoneNumber: NUMBER, state: "Pending" }, { phoneNumber: SECOND, state: "Failed" }] }, 202);
  assert.deepEqual(mixed.map(row => row.status), ["accepted", "failed"]);
  assert.match(await checkAndroid(settings(ENV), async () => { throw Error("offline"); }), /unreachable/);
  let body;
  await submitAndroid(settings({ ...ENV, SMS_GATEWAY_SIM: "" }), [NUMBER], "Test", ID, async (_url, options) => {
    body = JSON.parse(options.body); return reply({ id: ID, recipients: [{ phoneNumber: NUMBER, state: "Pending" }] }, 202);
  });
  assert.ok(!("simNumber" in body));
  console.log("PASS: mixed recipient outcomes, malformed results, default SIM, offline phone and uncertain timeouts never auto-resend");
  console.log("All Android gateway tests passed. No real phone was contacted and no SMS was sent.");
})().catch(error => { console.error(error); process.exitCode = 1; });
