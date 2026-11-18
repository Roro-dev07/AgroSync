"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { pathToFileURL } = require("node:url");
const { build, PUBLIC_FILES } = require("./build-site.cjs"), { deploymentCommands } = require("./deploy-netlify.cjs");
const { SMSError } = require("./broadcast-sms.cjs"), { createDashboardService } = require("./dashboard-data.cjs");
const root = __dirname;
const request = (route, options) => new Request("https://agrosyncgh.netlify.app" + route, options);
(async () => {
  const { createHandler: dashboardHandler, config: dashboardConfig } = await import(pathToFileURL(path.join(root, "netlify/functions/dashboard.mjs")).href);
  const { createHandler: messagingHandler, config: messagingConfig, default: realMessaging } = await import(pathToFileURL(path.join(root, "netlify/functions/broadcast-sms.mjs")).href);
  assert.equal(dashboardConfig.path, "/api/dashboard"); assert.equal(messagingConfig.path, "/api/broadcast-sms");
  let calls = 0;
  const fixture = { coordinates: { latitude: 5.6037, longitude: -0.187 }, sources: { weather: { data: {} } }, errors: { terrain: "offline" } };
  const dashboard = dashboardHandler({ get: async (lat, lon) => { calls++; assert.equal(lat, 5.6037); assert.equal(lon, -0.187); return fixture; } });
  const valid = await dashboard(request("/api/dashboard?latitude=5.6037&longitude=-0.187"));
  assert.equal(valid.status, 200); assert.deepEqual(await valid.json(), fixture);
  assert.equal(valid.headers.get("cache-control"), "no-store");
  for (const query of ["", "?latitude=&longitude=0", "?latitude=NaN&longitude=0", "?latitude=999&longitude=0", "?latitude=5.6&longitude=Infinity"]) {
    assert.equal((await dashboard(request("/api/dashboard" + query))).status, 400);
  }
  assert.equal((await dashboard(request("/api/dashboard", { method: "POST" }))).status, 405); assert.equal(calls, 1);
  assert.equal((await dashboardHandler({ get: async () => ({ sources: {}, errors: { weather: "offline" } }) })(request("/api/dashboard?latitude=5.6037&longitude=-0.187"))).status, 503);
  const failure = await dashboardHandler({ get: async () => { throw Error("private internal detail"); } })(request("/api/dashboard?latitude=5.6037&longitude=-0.187"));
  assert.equal(failure.status, 503); assert.ok(!(await failure.text()).includes("private internal"));
  console.log("PASS: hosted dashboard route, Ghana input validation, independent-source results and safe JSON error responses");

  const authorization = "Bearer test-session", id = "11111111-1111-4111-8111-111111111111";
  let submissions = 0;
  const messaging = messagingHandler({ status: async auth => { assert.equal(auth, authorization); return { ready: true, mode: "whatsapp" }; },
    send: async (auth, broadcastId, expectedMode) => { submissions++; assert.equal(auth, authorization); assert.equal(broadcastId, id); assert.equal(expectedMode, "whatsapp");
      return { mode: "whatsapp", manual: true, whatsappUrl: "https://wa.me/233240000001?text=Test" }; } });
  assert.equal((await realMessaging(request("/api/broadcast-sms"))).status, 401);
  assert.equal((await messaging(request("/api/broadcast-sms", { headers: { Authorization: authorization } }))).status, 200);
  const submitted = await messaging(request("/api/broadcast-sms", { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify({ broadcastId: id, expectedMode: "whatsapp" }) }));
  assert.equal(submitted.status, 200); assert.equal((await submitted.json()).manual, true); assert.equal(submissions, 1);
  assert.equal((await messaging(request("/api/broadcast-sms", { method: "POST", body: "bad" }))).status, 415);
  assert.equal((await messaging(request("/api/broadcast-sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: "bad" }))).status, 400);
  assert.equal((await messaging(request("/api/broadcast-sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(2049) }))).status, 413);
  const forbidden = messagingHandler({ status: async () => { throw new SMSError("Administrator required.", 403); } });
  assert.equal((await forbidden(request("/api/broadcast-sms"))).status, 403);
  console.log("PASS: hosted messaging route keeps authentication, JSON/size limits, expected-mode guard and manual WhatsApp responses");

  const service = createDashboardService({ requestTimeoutMs: 25, terrainDelay: 100, fetchImpl: async (url, options) => {
    if (url.includes("opentopodata")) return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(Error("timeout")), { once: true }));
    return { ok: true, json: async () => url.includes("open-meteo") ? { current: {}, hourly: { time: ["2026-11-15T00:00"] } } : { properties: { parameter: {} } } };
  } });
  // AbortSignal.timeout uses an unref'ed timer; keep this synthetic fetch test alive.
  const keepAlive = setTimeout(() => {}, 1000);
  let slow;
  try { slow = await Promise.all([service.get(5.6037, -0.187), service.get(6.6885, -1.6244)]); }
  finally { clearTimeout(keepAlive); }
  for (const data of slow) { assert.ok(data.sources.weather); assert.ok(data.sources.nasa); assert.ok(data.errors.terrain); }
  console.log("PASS: terrain queue deadline returns available weather/NASA data within a serverless request budget");

  const output = build(root).output;
  assert.deepEqual(fs.readdirSync(output).sort(), [...PUBLIC_FILES].sort());
  for (const name of PUBLIC_FILES) assert.deepEqual(fs.readFileSync(path.join(output, name)), fs.readFileSync(path.join(root, name)));
  for (const name of [".env", "serve.cjs", "dashboard-data.cjs", "broadcast-sms.cjs", "android-sms.cjs", "supabase-sms.sql", "whatsapp-cloud.cjs", "supabase-whatsapp.sql", "netlify.toml"]) assert.ok(!fs.existsSync(path.join(output, name)));
  for (const name of PUBLIC_FILES.filter(name => /\.(html|js|css)$/.test(name))) {
    assert.ok(!/atsk_[A-Za-z0-9]{20,}/.test(fs.readFileSync(path.join(output, name), "utf8")), "Provider key in a public asset");
  }
  const commands = deploymentCommands({ WHATSAPP_SELF_NUMBER: "+233240000001", AT_API_KEY: "DO_NOT_UPLOAD_TEST_KEY" });
  const args = commands.flatMap(command => command.args);
  assert.ok(args.includes("agrosyncgh")); assert.ok(args.includes("--prod")); assert.ok(args.includes("functions"));
  assert.ok(!args.includes("env:import")); assert.ok(!JSON.stringify(args).includes("DO_NOT_UPLOAD_TEST_KEY"));
  assert.throws(() => deploymentCommands({}), /WhatsApp/);
  assert.throws(() => deploymentCommands({ WHATSAPP_SELF_NUMBER: "+233240000001" }, "--bad-site"), /existing Netlify/);
  const html = fs.readFileSync(path.join(output, "index.html"), "utf8");
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) if (!match[1].startsWith("#") && !match[1].startsWith("https:")) assert.ok(fs.existsSync(path.join(output, match[1])));
  console.log("PASS: exact browser asset copies, raw background preserved, no secrets/server files in dist and deploy commands upload only selected WhatsApp settings");
  console.log("All hosting tests passed. No site was published and no messages were sent.");
})().catch(error => { console.error(error); process.exitCode = 1; });
