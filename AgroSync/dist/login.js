"use strict";
(() => {
  async function start() {
    const form = document.getElementById("admin-login");
    const status = document.getElementById("login-status"), tools = document.getElementById("admin-tools");
    const button = form.querySelector('button[type="submit"]');
    const report = text => { status.textContent = text; };
    const next = new URLSearchParams(window.location.search).get("next");
    const destination = ["registration.html", "broadcast.html"].includes(next) ? next : null;
    let busy = false;
    function signedIn(user) {
      form.hidden = true; tools.hidden = false;
      report("Signed in as " + (user.email || "AgroSync administrator") + ".");
    }
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (busy || !form.reportValidity()) return;
      busy = true; button.disabled = true; report("Signing in…");
      const password = document.getElementById("admin-password");
      try {
        const user = await AgroSyncBackend.signIn(document.getElementById("admin-email").value, password.value);
        signedIn(user);
        if (destination) window.location.assign(destination);
      } catch (error) { report(error.message); }
      finally { password.value = ""; busy = false; button.disabled = false; }
    });
    document.getElementById("admin-signout").addEventListener("click", async () => {
      try {
        await AgroSyncBackend.signOut();
        form.hidden = false; tools.hidden = true; report("Signed out of this browser.");
      } catch (error) { report(error.message); }
    });
    const importButton = document.getElementById("import-browser-farmers");
    importButton.addEventListener("click", async () => {
      importButton.disabled = true; report("Importing saved browser farmers…");
      try {
        const result = await FarmerDB.importLocalFarmers();
        report("Import complete: " + result.inserted + " added, " + result.skipped +
          " already registered. Original browser records have been preserved.");
      } catch (error) { report(error.message); }
      finally { importButton.disabled = false; }
    });
    document.getElementById("export-server-farmers").addEventListener("click", async () => {
      try { await FarmerDB.exportDatabaseJSON(); report("Server farmer export downloaded."); }
      catch (error) { report(error.message); }
    });
    if (window.location.protocol === "file:") {
      report("Open AgroSync using localhost or HTTPS so sign-in can be shared between pages.");
      button.disabled = true; return;
    }
    try {
      const user = await AgroSyncBackend.requireAdmin();
      signedIn(user);
      if (destination) window.location.replace(destination);
    } catch (error) {
      report(/sign-in required/i.test(error.message) ? "Sign in with the administrator account you created in Supabase." : error.message);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();

