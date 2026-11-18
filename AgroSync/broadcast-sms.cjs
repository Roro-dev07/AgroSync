/** Server only. No provider credentials or raw provider responses reach the browser. */
"use strict";
const { androidSettings, checkAndroid, submitAndroid } = require("./android-sms.cjs");
const { whatsappSettings, createWhatsAppCloud } = require("./whatsapp-cloud.cjs");
const PROJECT_URL = "https://vthwllinprcweahbxqyu.supabase.co";
const PUBLIC_KEY = "sb_publishable_J3LpDzXDqTSh1INx7vOX_g_-mkD9hfL";
const ADMIN_UID = "e7a38ce9-8104-4022-a137-8cca64113d2d";
class SMSError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}
function settings(env) {
  const provider = (env.SMS_PROVIDER || "africastalking").trim().toLowerCase();
  if (provider === "whatsapp-cloud") return whatsappSettings(env);
  if (provider === "whatsapp") {
    const selfNumber = phone(env.WHATSAPP_SELF_NUMBER || "");
    return { provider, mode: "whatsapp", selfNumber, problem: selfNumber ? "" :
      "Set WHATSAPP_SELF_NUMBER to your own Ghana WhatsApp number in .env." };
  }
  if (provider === "android") return androidSettings(env);
  if (provider !== "africastalking") return { provider, mode: "", problem: "Set SMS_PROVIDER to whatsapp-cloud, whatsapp, android or africastalking in .env." };
  const mode = (env.AT_ENVIRONMENT || "").trim().toLowerCase();
  const username = (env.AT_USERNAME || "").trim(), key = (env.AT_API_KEY || "").trim();
  const senderId = (env.AT_SENDER_ID || "").trim();
  let problem = "";
  if (!["live", "sandbox"].includes(mode)) problem = "Set AT_ENVIRONMENT to live or sandbox in the server .env file.";
  else if (!username || /^YOUR_/i.test(username)) problem = "Set AT_USERNAME to your Africa's Talking application username.";
  else if (!key || /^YOUR_/i.test(key)) problem = "Set AT_API_KEY in the private server .env file.";
  else if (mode === "sandbox" && username !== "sandbox") problem = "The Sandbox application username must be sandbox.";
  else if (mode === "live" && username === "sandbox") problem = "Use your Live application username for real SMS.";
  else if (mode === "live" && (!senderId || /^YOUR_/i.test(senderId))) problem = "Set AT_SENDER_ID to the sender ID approved for your Ghana Live application.";
  else if (senderId.length > 11 || /[\r\n]/.test(senderId)) problem = "Use a valid sender ID of at most 11 characters.";
  return { provider, mode, username, key, senderId, problem };
}
function phone(value) {
  let result = typeof value === "string" ? value.replace(/[\s().-]/g, "") : "";
  if (/^233\d{9}$/.test(result)) result = "+" + result;
  if (/^0\d{9}$/.test(result)) result = "+233" + result.slice(1);
  return /^\+233[235]\d{8}$/.test(result) ? result : null;
}
function outcomes(numbers, response, httpStatus) {
  const rows = response?.SMSMessageData?.Recipients;
  return numbers.map(number => {
    const base = { phone: number, status: "unknown", message_id: null, error_code: "UnconfirmedSubmission" };
    if ([400, 401, 403, 404, 405, 413, 415, 422, 429].includes(httpStatus)) {
      return { ...base, status: "failed", error_code: "ProviderHTTP" + httpStatus };
    }
    if (httpStatus < 200 || httpStatus >= 300 || !Array.isArray(rows)) return base;
    const matches = rows.filter(row => phone(row?.number) === number);
    if (matches.length !== 1) return base;
    const row = matches[0], code = Number(row.statusCode);
    const id = typeof row.messageId === "string" && row.messageId.trim() && !/^(none|null|n\/a)$/i.test(row.messageId) ? row.messageId : null;
    if ([100, 101, 102].includes(code) && id) return { ...base, status: "accepted", message_id: id, error_code: null };
    if (Number.isInteger(code) && code >= 400 && code < 500) return { ...base, status: "failed", error_code: "ProviderStatus" + code };
    return base;
  });
}
function createSMSService({ env = process.env, fetchImpl = globalThis.fetch,
  projectUrl = PROJECT_URL, publicKey = PUBLIC_KEY, adminUid = ADMIN_UID } = {}) {
  async function authenticate(authorization) {
    if (typeof authorization !== "string" || !/^Bearer [A-Za-z0-9._-]+$/.test(authorization)) {
      throw new SMSError("Administrator sign-in required.", 401);
    }
    let response;
    try {
      response = await fetchImpl(projectUrl + "/auth/v1/user", {
        headers: { apikey: publicKey, Authorization: authorization }, signal: AbortSignal.timeout(12000), redirect: "error"
      });
    } catch { throw new SMSError("Could not verify your sign-in. Check the connection and try again."); }
    if (!response.ok) throw new SMSError("Sign in again before broadcasting.", 401);
    let user;
    try { user = await response.json(); } catch { throw new SMSError("Sign-in verification returned an invalid response."); }
    if (user?.id !== adminUid) throw new SMSError("This account is not authorized to broadcast.", 403);
    return authorization;
  }
  async function rpc(authorization, name, body) {
    let response, data;
    try {
      response = await fetchImpl(projectUrl + "/rest/v1/rpc/" + name, {
        method: "POST", headers: { apikey: publicKey, Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(name.startsWith("agrosync_whatsapp_") ? 10000 : 15000), redirect: "error"
      });
      data = await response.json();
    } catch { throw new SMSError("The SMS database request could not be confirmed. Keep the same broadcast and retry."); }
    if (!response.ok) {
      if (["PGRST202", "42883", "42P01", "42703"].includes(data?.code)) throw new SMSError(name.startsWith("agrosync_whatsapp_") ?
        "Run supabase-whatsapp.sql in Supabase SQL Editor to enable WhatsApp delivery." :
        "Run supabase-sms.sql in the Supabase SQL Editor to enable SMS tracking.");
      if ([401, 403].includes(response.status)) throw new SMSError("SMS database access was denied. Sign in as the authorized administrator.", response.status);
      if (data?.code === "P0001") throw new SMSError(data.message || "The broadcast could not be prepared.", 409);
      throw new SMSError("The SMS database operation failed. Check that supabase-sms.sql ran successfully.");
    }
    return data;
  }
  const whatsappCache = {};
  const whatsapp = authorization => createWhatsAppCloud({ env, fetchImpl, cache: whatsappCache,
    rpc: (name, body) => rpc(authorization, name, body), ErrorClass: SMSError });
  async function status(authorization, broadcastId) {
    await authenticate(authorization);
    const config = settings(env);
    if (config.problem) return { ready: false, mode: config.mode, message: config.problem };
    if (config.provider === "whatsapp-cloud") return whatsapp(authorization).status(broadcastId);
    if (config.provider === "whatsapp") return { ready: true, mode: config.mode,
      message: "WhatsApp self-chat handoff ready. Sending on WhatsApp and forwarding as SMS are manual." };
    try {
      const schema = await rpc(authorization, "agrosync_sms_summary", { p_broadcast_id: "00000000-0000-0000-0000-000000000000" });
      if (config.provider === "android" && schema?.schema_version !== 2) return { ready: false, mode: config.mode,
        message: "Run the updated supabase-sms.sql in Supabase SQL Editor to enable the Android gateway." };
    }
    catch (error) { return { ready: false, mode: config.mode, message: error.message }; }
    if (config.provider === "android") {
      const problem = await checkAndroid(config, fetchImpl);
      return { ready: !problem, mode: config.mode, message: problem || "Phone gateway reachable. SMS uses your SIM number and carrier credit." };
    }
    return { ready: true, mode: config.mode, message: config.mode === "live" ?
      "Live SMS ready. Sending uses Africa's Talking account credit." : "Sandbox ready. Messages appear in the simulator, not on real phones." };
  }
  async function send(authorization, broadcastId, expectedMode) {
    await authenticate(authorization);
    const config = settings(env);
    if (config.problem) throw new SMSError(config.problem);
    if (expectedMode !== undefined && expectedMode !== config.mode) throw new SMSError("Messaging mode changed. Reload the broadcast page before continuing.", 409);
    if (typeof broadcastId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(broadcastId)) {
      throw new SMSError("A valid saved broadcast ID is required.", 400);
    }
    if (config.provider === "whatsapp-cloud") return whatsapp(authorization).send(broadcastId);
    if (config.provider === "whatsapp") {
      // Read only the saved advisory. Farmer names/numbers are not sent to WhatsApp.
      let response, rows;
      try {
        response = await fetchImpl(projectUrl + "/rest/v1/broadcasts?id=eq." + encodeURIComponent(broadcastId) + "&select=id,message&limit=1", {
          headers: { apikey: publicKey, Authorization: authorization }, signal: AbortSignal.timeout(15000), redirect: "error"
        });
        rows = await response.json();
      } catch { throw new SMSError("The saved advisory could not be loaded. Keep this draft and try again."); }
      if (!response.ok) throw new SMSError("Access to the saved advisory was denied or unavailable. Check your administrator sign-in.");
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== broadcastId) throw new SMSError("Saved broadcast not found.", 404);
      const message = rows[0].message;
      if (typeof message !== "string" || !message.trim() || [...message].length > 1600) throw new SMSError("The saved advisory must contain 1 to 1600 characters.", 400);
      return { broadcastId, mode: "whatsapp", manual: true,
        whatsappUrl: "https://wa.me/" + config.selfNumber.slice(1) + "?text=" + encodeURIComponent(message) };
    }
    const claim = await rpc(authorization, "agrosync_sms_claim", { p_broadcast_id: broadcastId, p_environment: config.mode });
    if (!Array.isArray(claim?.recipients) || claim.recipients.length > 100 || !claim.claim_id ||
        typeof claim.message !== "string" || !claim.message.trim() || [...claim.message].length > 1600 ||
        new Set(claim.recipients).size !== claim.recipients.length) {
      throw new SMSError("The database did not confirm a valid SMS batch. Nothing was submitted.");
    }
    let summary = claim, results = [];
    if (claim.recipients.length) {
      const valid = claim.recipients.filter(number => phone(number) === number);
      results = claim.recipients.filter(number => phone(number) !== number).map(number =>
        ({ phone: number, status: "failed", message_id: null, error_code: "InvalidStoredPhone" }));
      if (valid.length && config.provider === "android") {
        results.push(...await submitAndroid(config, valid, claim.message, claim.claim_id, fetchImpl));
      } else if (valid.length) {
        const body = new URLSearchParams({ username: config.username, to: valid.join(","), message: claim.message, bulkSMSMode: "1", enqueue: "1" });
        if (config.senderId) body.set("from", config.senderId);
        let providerResponse = null, httpStatus = 0;
        try {
          const response = await fetchImpl((config.mode === "live" ? "https://api.africastalking.com" :
            "https://api.sandbox.africastalking.com") + "/version1/messaging", {
            method: "POST", headers: { apiKey: config.key, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(), signal: AbortSignal.timeout(25000), redirect: "error"
          });
          httpStatus = response.status;
          try { providerResponse = await response.json(); } catch { /* Preserve uncertainty for malformed success responses. */ }
        } catch { /* It may have been accepted before a timeout. Never blindly resubmit. */ }
        results.push(...outcomes(valid, providerResponse, httpStatus));
      }
      // This database-only operation is idempotent. Never repeat the provider call here.
      const finish = () => rpc(authorization, "agrosync_sms_finish", {
        p_broadcast_id: broadcastId, p_claim_id: claim.claim_id, p_results: results
      });
      try { summary = await finish(); }
      catch {
        try { summary = await finish(); }
        catch { throw new SMSError("SMS submission results could not be saved. Check " +
          (config.provider === "android" ? "the phone's SMSGate message history" : "Africa's Talking reports") +
          " using this broadcast ID before retrying: " + broadcastId); }
      }
    }
    const result = { broadcastId, mode: config.mode, errors: [...new Set(results.map(row => row.error_code).filter(Boolean))] };
    for (const field of ["total", "pending", "processing", "accepted", "failed", "unknown"]) {
      if (!Number.isSafeInteger(summary[field]) || summary[field] < 0) throw new SMSError("The SMS result summary could not be confirmed. Review provider reports before retrying.");
      result[field] = summary[field];
    }
    return result;
  }
  return { status, send };
}
module.exports = { createSMSService, SMSError, settings, outcomes };
