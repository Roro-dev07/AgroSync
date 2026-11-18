/** One command for the existing Netlify project; no full .env import or anonymous site. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { spawnSync } = require("node:child_process"), { parseEnv } = require("node:util");
const VERSION = "27.19.0";
function deploymentCommands(local, site = "agrosyncgh") {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(site)) throw Error("Use a valid existing Netlify project name.");
  if ((local.SMS_PROVIDER || "").trim() === "whatsapp-cloud") {
    const config = require("./whatsapp-cloud.cjs").whatsappSettings(local);
    if (config.problem) throw Error(config.problem);
    const selected = ["SMS_PROVIDER", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID",
      "WHATSAPP_TEMPLATE_NAME", "WHATSAPP_TEMPLATE_LANGUAGE", "WHATSAPP_GRAPH_VERSION", "WHATSAPP_APP_SECRET",
      "WHATSAPP_VERIFY_TOKEN", "SUPABASE_SERVICE_ROLE_KEY"];
    const values = { ...local, WHATSAPP_TEMPLATE_LANGUAGE: config.language, WHATSAPP_GRAPH_VERSION: config.version };
    return [{ args: ["login"], quiet: false }, ...selected.map(key => ({
      args: ["env:set", key, values[key].trim(), "--scope", "functions", "--site", site, "--force"], quiet: true
    })), { args: ["deploy", "--site", site, "--prod", "--context", "production", "--message", "Enable AgroSync WhatsApp Cloud delivery"], quiet: false }];
  }
  const number = (local.WHATSAPP_SELF_NUMBER || "").trim().replace(/[\s().-]/g, "");
  if (!/^(?:\+?233[235]\d{8}|0[235]\d{8})$/.test(number)) throw Error("Set your own WhatsApp number in .env before deploying.");
  const verificationToken = (local.WHATSAPP_VERIFY_TOKEN || "").trim();
  if (verificationToken && (verificationToken.length < 24 || /^YOUR_/i.test(verificationToken))) throw Error("Set a private WHATSAPP_VERIFY_TOKEN of at least 24 characters in .env.");
  return [
    { args: ["login"], quiet: false },
    { args: ["env:set", "SMS_PROVIDER", "whatsapp", "--scope", "functions", "--site", site, "--force"], quiet: true },
    { args: ["env:set", "WHATSAPP_SELF_NUMBER", number, "--scope", "functions", "--site", site, "--force"], quiet: true },
    ...(verificationToken ? [{ args: ["env:set", "WHATSAPP_VERIFY_TOKEN", verificationToken, "--scope", "functions", "--site", site, "--force"], quiet: true }] : []),
    { args: ["deploy", "--site", site, "--prod", "--context", "production", "--message", "Enable hosted AgroSync dashboard and WhatsApp handoff"], quiet: false }
  ];
}
function main() {
  const root = __dirname, envFile = path.join(root, ".env");
  if (!fs.existsSync(envFile)) throw Error("The private .env file is missing. Follow NETLIFY-DEPLOY.md.");
  const local = parseEnv(fs.readFileSync(envFile, "utf8"));
  const commands = deploymentCommands(local, process.argv[2] || "agrosyncgh");
  const npmScript = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  const installedCLI = path.join(os.tmpdir(), "agrosync-netlify-tools/node_modules/netlify-cli/bin/run.js");
  const prefix = fs.existsSync(installedCLI) ? [installedCLI] :
    [npmScript, "exec", "--yes", "--package", "netlify-cli@" + VERSION, "--", "netlify"];
  if (!fs.existsSync(prefix[0])) throw Error("Run this deployment using npm.cmd run deploy:netlify.");
  require("./build-site.cjs").build(root);
  console.log("Preparing to publish the pages and backend functions to your existing Netlify project.");
  console.log("Sign in to Netlify when prompted. Only WhatsApp settings will be configured; unused SMS keys are not uploaded.");
  for (const command of commands) {
    const result = spawnSync(process.execPath, [...prefix, ...command.args],
      { cwd: root, shell: false, stdio: command.quiet ? "pipe" : "inherit", encoding: "utf8",
        env: { ...process.env, npm_config_cache: path.join(os.tmpdir(), "agrosync-netlify-cache"), NETLIFY_TELEMETRY_DISABLED: "1" } });
    if (result.error || result.status !== 0) throw Error(command.quiet ?
      "Netlify could not save the WhatsApp configuration. Check your account access to this project, then retry." :
      "The Netlify command did not finish successfully. Resolve the displayed login or deployment error, then retry.");
  }
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { deploymentCommands };
