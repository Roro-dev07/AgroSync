"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createSMSService, settings } = require("./broadcast-sms.cjs");
const ADMIN = "e7a38ce9-8104-4022-a137-8cca64113d2d", ID = "11111111-1111-4111-8111-111111111111";
const AUTH = "Bearer test-admin-token", NUMBER = "+233240000001";
const ENV = { SMS_PROVIDER: "whatsapp", WHATSAPP_SELF_NUMBER: NUMBER };
const TEXT = "AgroSync: Check drainage & soil moisture.\nReview the field before watering. 🌱";
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function fixture({ env = ENV, user = ADMIN, rows = [{ id: ID, message: TEXT }], httpStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/auth/v1/user")) return reply({ id: user });
    assert.match(url, /^https:\/\/vthwllinprcweahbxqyu\.supabase\.co\/rest\/v1\/broadcasts\?/);
    assert.equal(options.headers.Authorization, AUTH);
    assert.equal(options.method || "GET", "GET");
    assert.match(url, /select=id,message/);
    return reply(rows, httpStatus);
  };
  return { service: createSMSService({ env, fetchImpl }), calls };
}
async function browserTest(badLink = false) {
  class Element {
    constructor(value = "") { this.value = value; this.events = {}; this.dataset = {}; this.disabled = false; this.children = []; this._text = ""; }
    set textContent(text) { this._text = text; this.children = []; } get textContent() { return this._text; }
    setAttribute() {} addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
    appendChild(child) { this.children.push(child); } replaceChildren() { this.children = []; } reportValidity() { return true; }
  }
  const status = new Element(), button = new Element(), form = new Element(); button.textContent = "Broadcast message";
  const region = new Element(), locality = new Element(), message = new Element();
  form.querySelector = selector => selector.includes("field-help") ? status : button;
  const nodes = { "broadcast-region": region, "broadcast-locality": locality, message };
  const document = { readyState: "loading", events: {}, querySelector: () => form, getElementById: id => nodes[id],
    createElement: () => new Element(), addEventListener(name, fn) { this.events[name] = fn; } };
  let preparations = 0;
  const context = vm.createContext({ document, console, URL, setTimeout, clearTimeout,
    crypto: require("node:crypto").webcrypto, sessionStorage: { getItem: () => null, setItem() {} },
    window: { addEventListener() {}, location: { assign() {}, replace() {} }, open() { throw Error("Do not auto-open WhatsApp after an async save"); } },
    AgroSyncBackend: { requireAdmin: async () => ({}), getClient: () => ({ auth: { onAuthStateChange() {} } }) },
    FarmerDB: { getRegions: () => ["Greater Accra"], getFarmersByLocality: async () => [1],
      getSMSStatus: async () => ({ ready: true, mode: "whatsapp", message: "Manual handoff ready." }),
      createBroadcastDraft: async () => ({ id: ID, recipientCount: 1 }),
      sendBroadcast: async (id, expectedMode) => {
        preparations++; assert.equal(id, ID); assert.equal(expectedMode, "whatsapp");
        return { mode: "whatsapp", manual: true, whatsappUrl:
          (badLink ? "https://wa.me.example.com/" : "https://wa.me/") + NUMBER.slice(1) + "?text=" + encodeURIComponent(TEXT) };
      } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "broadcast.js"), "utf8"), context);
  await document.events.DOMContentLoaded();
  assert.equal(button.textContent, "Prepare WhatsApp message");
  region.value = "Greater Accra"; locality.value = "Accra"; message.value = TEXT;
  for (const submit of form.events.submit) await submit({ preventDefault() {} });
  assert.equal(preparations, 1); assert.equal(button.disabled, false);
  if (badLink) { assert.equal(status.children.length, 0); assert.match(status.textContent, /valid WhatsApp/); return; }
  assert.match(status.textContent, /does not send SMS/);
  assert.equal(status.children.length, 1);
  const link = status.children[0], url = new URL(link.href);
  assert.equal(link.textContent, "Open WhatsApp"); assert.equal(link.target, "_blank"); assert.equal(link.rel, "noopener noreferrer");
  assert.equal(url.hostname, "wa.me"); assert.equal(url.pathname, "/" + NUMBER.slice(1));
  assert.equal(url.searchParams.get("text"), TEXT);
  message.value = "Edited advisory";
  for (const onInput of message.events.input) onInput();
  assert.equal(status.children.length, 0, "Editing must invalidate the old link");
  assert.match(status.textContent, /updated link/);
}
(async () => {
  for (const number of [NUMBER, "0240000001", "233240000001"]) assert.equal(settings({ ...ENV, WHATSAPP_SELF_NUMBER: number }).selfNumber, NUMBER);
  assert.match(settings({ ...ENV, WHATSAPP_SELF_NUMBER: "" }).problem, /own Ghana WhatsApp/);
  const handoff = fixture();
  assert.equal((await handoff.service.status(AUTH)).ready, true);
  assert.equal(handoff.calls.length, 1, "WhatsApp readiness needs no SMS tracking migration or provider call");
  const result = await handoff.service.send(AUTH, ID, "whatsapp");
  const url = new URL(result.whatsappUrl);
  assert.equal(result.manual, true); assert.equal(result.mode, "whatsapp");
  assert.equal(url.hostname, "wa.me"); assert.equal(url.pathname, "/" + NUMBER.slice(1));
  assert.equal(url.searchParams.get("text"), TEXT);
  assert.ok(!("accepted" in result)); assert.ok(!("delivered" in result));
  assert.ok(handoff.calls.every(call => !call.url.includes("/rpc/")), "Preparing a link must not claim SMS recipients or change submission states");
  assert.ok(!JSON.stringify(result).includes("farmer_id"));
  console.log("PASS: self-number normalization, exact Unicode/URL encoding, saved-advisory lookup, no SMS migrations/provider calls and no false delivery state");
  const anon = fixture(); await assert.rejects(anon.service.send(undefined, ID), error => error.status === 401); assert.equal(anon.calls.length, 0);
  const outsider = fixture({ user: "other-user" }); await assert.rejects(outsider.service.send(AUTH, ID), error => error.status === 403);
  await assert.rejects(fixture().service.send(AUTH, "bad-id"), error => error.status === 400);
  await assert.rejects(fixture({ rows: [] }).service.send(AUTH, ID), error => error.status === 404);
  await assert.rejects(fixture({ rows: [null] }).service.send(AUTH, ID), error => error.status === 404);
  await assert.rejects(fixture({ rows: [{ id: ID, message: "x".repeat(1601) }] }).service.send(AUTH, ID), error => error.status === 400);
  const changed = fixture({ env: { SMS_PROVIDER: "africastalking", AT_ENVIRONMENT: "live", AT_USERNAME: "test-user", AT_API_KEY: "test-secret", AT_SENDER_ID: "AgroSync" } });
  await assert.rejects(changed.service.send(AUTH, ID, "whatsapp"), error => error.status === 409);
  assert.equal(changed.calls.length, 1, "A mode mismatch must stop before any provider or draft request");
  console.log("PASS: admin-only access, unavailable/malformed drafts and mode changes cannot trigger SMS sending");
  await browserTest(); await browserTest(true);
  console.log("PASS: existing button prepares a user-clicked self-chat link, manual-forwarding instructions, blocked untrusted URLs and stale-link invalidation");
  console.log("All WhatsApp handoff tests passed. No WhatsApp message or SMS was sent.");
})().catch(error => { console.error(error); process.exitCode = 1; });
