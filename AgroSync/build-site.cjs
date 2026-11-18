/** Publish only explicitly listed browser assets. Never publish the project root. */
"use strict";
const fs = require("node:fs"), path = require("node:path");
const PUBLIC_FILES = Object.freeze([
  "index.html", "registration.html", "broadcast.html", "login.html",
  "style.css", "registration.css", "broadcast.css", "bkg3.jpg",
  "script.js", "registration.js", "broadcast.js", "login.js",
  "farmerDB.js", "serverDB.js", "supabase-config.js", "mofa-advisories.js", "rotation-planner.js"
]);
function build(root = __dirname) {
  root = path.resolve(root);
  const output = path.resolve(root, "dist");
  // Check the resolved Windows target before replacing the generated directory.
  if (path.dirname(output) !== root || path.basename(output) !== "dist") throw Error("Invalid build output path.");
  for (const name of PUBLIC_FILES) {
    if (!fs.statSync(path.join(root, name)).isFile()) throw Error("Missing browser asset: " + name);
  }
  if (fs.existsSync(output)) {
    const stat = fs.lstatSync(output), actual = fs.realpathSync(output);
    const canonical = text => process.platform === "win32" ? text.toLowerCase() : text;
    if (!stat.isDirectory() || stat.isSymbolicLink() || canonical(actual) !== canonical(output)) throw Error("Build output must be a real directory inside this project.");
    fs.rmSync(output, { recursive: true, force: true });
  }
  fs.mkdirSync(output);
  for (const name of PUBLIC_FILES) fs.copyFileSync(path.join(root, name), path.join(output, name));
  return { output, files: [...PUBLIC_FILES] };
}
if (require.main === module) console.log("Built " + build().files.length + " public assets in dist; deploy Netlify functions with these assets.");
module.exports = { build, PUBLIC_FILES };
