/** Existing registration form -> Supabase; success is shown only after server confirmation. */
"use strict";
(() => {
  async function start() {
    const form = document.querySelector("form.reg-form");
    if (!form || form.dataset.registrationBound) return;
    form.dataset.registrationBound = "true";
    form.addEventListener("submit", event => event.preventDefault());
    const status = form.querySelector(".form-actions .field-help");
    const button = form.querySelector('button[type="submit"]');
    const report = text => { if (status) status.textContent = text; };
    status?.setAttribute("role", "status");
    status?.setAttribute("aria-live", "polite");
    if (button) button.disabled = true;
    let ready = false, saving = false;
    const inputs = Object.fromEntries(["firstname","lastname","region","locality","contact"].map(id => [id, document.getElementById(id)]));
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!ready || saving || !form.reportValidity()) return;
      saving = true; if (button) button.disabled = true;
      report("Saving farmer to Supabase…");
      try {
        const saved = await FarmerDB.registerFarmer({ firstName: inputs.firstname.value,
          lastName: inputs.lastname.value, region: inputs.region.value,
          locality: inputs.locality.value, phone: inputs.contact.value,
          whatsappOptIn: document.getElementById("whatsapp-consent")?.checked === true });
        report("Registered " + saved.fullName + " in " + saved.locality + ", " + saved.region + ". Saved on the server.");
        form.reset();
      } catch (error) { report(error.message); }
      finally { saving = false; if (button) button.disabled = false; }
    });
    try {
      if (Object.values(inputs).some(input => !input)) throw new Error("A registration field is missing.");
      if (typeof AgroSyncBackend === "undefined" || typeof FarmerDB === "undefined") throw new Error("Database scripts failed to load. Reload this page.");
      await AgroSyncBackend.requireAdmin();
      ready = true; if (button) button.disabled = false;
      report("Connected to Supabase. Registrations are saved on the server.");
      AgroSyncBackend.getClient().auth.onAuthStateChange(event => {
        if (event === "SIGNED_OUT") { ready = false; window.location.assign(AgroSyncBackend.loginPath("registration.html")); }
      });
    } catch (error) {
      report(error.message);
      if (/sign-in required|not authorized/i.test(error.message)) {
        window.location.replace(AgroSyncBackend.loginPath("registration.html"));
      }
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();

