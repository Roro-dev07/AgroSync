/** Local SMSGate adapter. Credentials remain on the Node server. */
"use strict";
const { isIP } = require("node:net");
function androidSettings(env) {
  const rawUrl = (env.SMS_GATEWAY_URL || "").trim();
  const username = (env.SMS_GATEWAY_USERNAME || "").trim();
  const password = env.SMS_GATEWAY_PASSWORD || "";
  const simText = (env.SMS_GATEWAY_SIM || "").trim();
  let origin = "", problem = "";
  try {
    const url = new URL(rawUrl), octets = url.hostname.split(".").map(Number);
    const local = isIP(url.hostname) === 4 && (octets[0] === 10 || octets[0] === 127 ||
      (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
    if (!local || !["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) throw Error("Invalid local URL");
    origin = url.origin;
  } catch { problem = "Set SMS_GATEWAY_URL to the phone's local address, for example http://192.168.1.20:8080."; }
  if (!problem && (!password || /^YOUR_/i.test(password))) problem = "Enter the SMSGate Local Server password in the private .env file.";
  if (!problem && (username.includes(":") || /[\r\n]/.test(username))) problem = "Copy the Local Server username exactly from SMSGate.";
  if (!problem && simText && !/^[123]$/.test(simText)) problem = "Set SMS_GATEWAY_SIM to 1, 2 or 3, or leave it empty for the phone's default SMS SIM.";
  return { provider: "android", mode: "android", origin, username, password, sim: simText ? Number(simText) : null, problem };
}
const headers = config => ({ Authorization: "Basic " + Buffer.from(config.username + ":" + config.password).toString("base64"), Accept: "application/json" });
async function checkAndroid(config, fetchImpl) {
  try {
    const response = await fetchImpl(config.origin + "/health", { headers: headers(config),
      signal: AbortSignal.timeout(5000), redirect: "error" });
    if ([401, 403].includes(response.status)) return "Check the SMSGate Local Server username and password in .env.";
    if (!response.ok) return "SMSGate is not ready. Enable Local Server and tap Start Service on the phone.";
    return "";
  } catch { return "The phone gateway is unreachable. Keep Local Server running and connect the phone and computer to the same Wi-Fi network."; }
}
function androidOutcomes(numbers, response, httpStatus) {
  return numbers.map(number => {
    const base = { phone: number, status: "unknown", message_id: null, error_code: "UnconfirmedGatewaySubmission" };
    if ([400, 401, 403, 404, 405, 413, 415, 422, 429].includes(httpStatus)) {
      return { ...base, status: "failed", error_code: "GatewayHTTP" + httpStatus };
    }
    if (httpStatus < 200 || httpStatus >= 300 || typeof response?.id !== "string" || !response.id.trim() ||
        !Array.isArray(response.recipients)) return base;
    const matches = response.recipients.filter(row => row?.phoneNumber === number);
    if (matches.length !== 1) return base;
    const state = matches[0].state;
    if (["Pending", "Processed", "Sent", "Delivered"].includes(state)) {
      return { ...base, status: "accepted", message_id: response.id, error_code: null };
    }
    if (["Failed", "Cancelled"].includes(state)) return { ...base, status: "failed", message_id: response.id, error_code: "Gateway" + state };
    return base;
  });
}
async function submitAndroid(config, numbers, message, claimId, fetchImpl) {
  const body = { id: claimId, textMessage: { text: message }, phoneNumbers: numbers,
    withDeliveryReport: true, ttl: 3600, priority: 0 };
  if (config.sim) body.simNumber = config.sim;
  let data = null, httpStatus = 0;
  try {
    const response = await fetchImpl(config.origin + "/message", { method: "POST",
      headers: { ...headers(config), "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000), redirect: "error" });
    httpStatus = response.status;
    try { data = await response.json(); } catch { /* An invalid response cannot confirm submission. */ }
  } catch { /* The phone might already have queued SMS before a timeout. Do not repeat POST. */ }
  return androidOutcomes(numbers, data, httpStatus);
}
module.exports = { androidSettings, checkAndroid, androidOutcomes, submitAndroid };
