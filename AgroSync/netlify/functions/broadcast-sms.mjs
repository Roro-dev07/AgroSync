import smsModule from "../../broadcast-sms.cjs";
const { createSMSService, SMSError } = smsModule;
const service = createSMSService();
const json = (status, body) => new Response(JSON.stringify(body), { status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
export function createHandler(sms = service) {
  return async request => {
    try {
      const authorization = request.headers.get("authorization");
      if (request.method === "GET") return json(200, await sms.status(authorization, new URL(request.url).searchParams.get("broadcastId")));
      if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
      if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") || "")) return json(415, { error: "Use a JSON broadcast request." });
      const raw = await request.text();
      if (Buffer.byteLength(raw, "utf8") > 2048) return json(413, { error: "Messaging request is too large." });
      let body;
      try { body = JSON.parse(raw); }
      catch { return json(400, { error: "Invalid messaging request." }); }
      return json(200, await sms.send(authorization, body?.broadcastId, body?.expectedMode));
    } catch (error) {
      return json(error instanceof SMSError ? error.status : 500,
        { error: error instanceof SMSError ? error.message : "The messaging service is temporarily unavailable. Please try again shortly." });
    }
  };
}
export default createHandler();
export const config = { path: "/api/broadcast-sms" };
