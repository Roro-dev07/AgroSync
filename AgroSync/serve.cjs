/** Run: node serve.cjs. Same-origin weather data and authenticated server-side SMS. */
"use strict";
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const { createDashboardService } = require("./dashboard-data.cjs");
const { createSMSService, SMSError } = require("./broadcast-sms.cjs");
const { createWhatsAppWebhook, MAX_WEBHOOK_BYTES } = require("./whatsapp-cloud.cjs");
const root = __dirname;
const mime = { ".pdf": "application/pdf", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp" };
function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(data));
}
function createAppServer({ dashboard = createDashboardService(), sms = createSMSService(), whatsappWebhook = createWhatsAppWebhook() } = {}) {
return http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/whatsapp-webhook") {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_WEBHOOK_BYTES) { res.writeHead(413); res.end("Webhook request too large."); return; }
        chunks.push(chunk);
      }
      const result = await whatsappWebhook({ method: req.method, url: req.url,
        signature: req.headers["x-hub-signature-256"], raw: Buffer.concat(chunks) });
      res.writeHead(result.status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.end(result.text); return;
    }
    if (url.pathname === "/api/broadcast-sms") {
      if (req.method === "GET") { json(res, 200, await sms.status(req.headers.authorization, url.searchParams.get("broadcastId"))); return; }
      if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
      if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) throw new SMSError("Use a JSON broadcast request.", 415);
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2048) throw new SMSError("SMS request is too large.", 413);
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw new SMSError("Invalid SMS request.", 400); }
      json(res, 200, await sms.send(req.headers.authorization, body?.broadcastId, body?.expectedMode)); return;
    }
    if (!["GET","HEAD"].includes(req.method)) { res.writeHead(405); res.end(); return; }
    if (url.pathname === "/api/dashboard") {
      if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
      const rawLat = url.searchParams.get("latitude"), rawLon = url.searchParams.get("longitude");
      if (rawLat === null || rawLon === null || !rawLat.trim() || !rawLon.trim()) {
        json(res, 400, { error: "Latitude and longitude are required." }); return;
      }
      const lat = Number(rawLat), lon = Number(rawLon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 4.5 || lat > 11.3 || lon < -3.3 || lon > 1.3) {
        json(res, 400, { error: "Enter coordinates within Ghana's bounding area." }); return;
      }
      const data = await dashboard.get(lat, lon);
      json(res, Object.keys(data.sources).length ? 200 : 503, data); return;
    }
    const pathname = decodeURIComponent(url.pathname);
    const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    const relative = path.relative(root, file), type = mime[path.extname(file).toLowerCase()];
    if (relative.startsWith("..") || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part.startsWith(".")) || !type) {
      res.writeHead(404); res.end("Not found"); return;
    }
    fs.readFile(file, (error, contents) => {
      if (error) { res.writeHead(404); res.end("Not found"); return; }
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.end(req.method === "HEAD" ? undefined : contents);
    });
  } catch (error) {
    json(res, error instanceof SMSError ? error.status : 500,
      { error: error instanceof SMSError ? error.message : "Server request failed. Try again shortly." });
  }
});
}
if (require.main === module) {
  const envFile = path.join(root, ".env");
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const server = createAppServer();
  server.on("error", error => { console.error(error.message); process.exitCode = 1; });
  const port = Number(process.env.AGROSYNC_PORT || 5500);
  server.listen(port, "127.0.0.1", () => console.log("AgroSync dashboard: http://127.0.0.1:" + port + "/ (Ctrl+C to stop)"));
}
module.exports = { createAppServer };

