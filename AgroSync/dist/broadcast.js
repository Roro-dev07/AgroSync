/** Server-backed locality recall, atomic drafts and authenticated SMS submission. */
"use strict";
(() => {
  async function start() {
    const form = document.querySelector("form.reg-form");
    if (!form || form.dataset.broadcastBound) return;
    form.dataset.broadcastBound = "true";
    form.addEventListener("submit", event => event.preventDefault());
    const region = document.getElementById("broadcast-region"), locality = document.getElementById("broadcast-locality");
    const message = document.getElementById("message"), status = form.querySelector(".form-actions .field-help");
    const button = form.querySelector('button[type="submit"]');
    const messageHelp = document.getElementById("message-help"), defaultMessageHelp = messageHelp?.textContent;
    const report = text => { if (status) status.textContent = text; };
    status?.setAttribute("role", "status"); status?.setAttribute("aria-live", "polite");
    if (button) button.disabled = true;
    let ready = false, saving = false, preview = 0, timer, pending = null;
    let deliveryTimer, deliveryRun = 0, lastCloudBroadcast = null;
    function stopTracking() { ++deliveryRun; clearTimeout(deliveryTimer); lastCloudBroadcast = null; }
    function cloudReport(result) {
      const notes = {
        MetaError190: "Check the Meta access token.", MetaError132000: "Check the template parameters.",
        MetaError132001: "Check the approved template name and language.", MetaError131026: "Some numbers could not receive WhatsApp messages.",
        MetaError131047: "Check that an approved message template is being used.",
        MetaError131042: "Check the WhatsApp Business account payment settings.",
        MetaError131049: "Meta declined some messages under its delivery limits.",
        MetaHTTP429: "Meta's sending limit was reached.", InvalidStoredPhone: "Review invalid stored phone numbers."
      };
      report("WhatsApp: " + result.accepted + " accepted, " + result.sent + " sent, " + result.delivered + " delivered, " +
        result.read + " read, " + result.failed + " failed, " + result.skipped + " skipped, " + result.unknown + " uncertain, " +
        result.processing + " processing, " + result.pending + " pending. Accepted or sent does not confirm delivery. " +
        (result.skipped ? "Skipped farmers have not agreed to WhatsApp updates or are no longer eligible. " : "") +
        (result.errors || []).map(code => notes[code] || code).join(" ") +
        (result.unknown ? " Check delivery records for broadcast " + (result.broadcastId || lastCloudBroadcast || "") + " before any resend." : ""));
    }
    function trackDelivery(id, run = ++deliveryRun, attempt = 0) {
      lastCloudBroadcast = id;
      deliveryTimer = setTimeout(async () => {
        if (run !== deliveryRun || saving || !ready) return;
        try {
          const response = await FarmerDB.getBroadcastDelivery(id);
          if (run !== deliveryRun || saving || !ready) return;
          if (response.mode !== "whatsapp-cloud" || !response.delivery) return;
          cloudReport(response.delivery);
          const d = response.delivery;
          if (attempt < 11 && (d.accepted || d.sent || d.processing || d.unknown)) trackDelivery(id, run, attempt + 1);
        } catch (error) { if (run === deliveryRun) report("The broadcast is saved. Delivery updates are unavailable: " + error.message); }
      }, 5000);
    }
    let importedMessage = null, messageEdited = Boolean(message?.value.trim());
    function loadRecommendation() {
      if (!ready || saving || messageEdited || !message ||
          (message.value.trim() && message.value !== importedMessage)) return;
      let raw, draft;
      try { raw = localStorage.getItem("agrosync.recommendationDraft"); } catch { return; }
      try { draft = JSON.parse(raw); } catch { draft = null; }
      const age = Date.now() - draft?.generatedAt;
      const valid = draft?.version === 1 && typeof draft.text === "string" && draft.text.trim() &&
        [...draft.text].length <= 1600 && typeof draft.generatedAt === "number" && Number.isFinite(draft.generatedAt) &&
        age >= 0 && age <= 6 * 3600000 && typeof draft.title === "string" && draft.title.length <= 200 &&
        typeof draft.location === "string" && draft.location.length <= 200;
      if (!valid) {
        if (importedMessage !== null) { message.value = ""; importedMessage = null; }
        if (messageHelp) messageHelp.textContent = "Choose a crop and its actual stage on the dashboard to load a recent recommendation, or write your own message.";
        return;
      }
      if (message.value === draft.text) return;
      stopTracking();
      message.value = draft.text; importedMessage = draft.text;
      if (messageHelp) messageHelp.textContent = "Recommendation loaded: " + draft.title +
        (draft.location ? " · " + draft.location : "") + ". Review the advice and select the matching recipient region and locality before broadcasting.";
      // Discard any old handoff link; importing text never saves or sends a broadcast.
      report(sms.mode === "whatsapp" ? "Recommendation loaded as a draft. Review it, then click Prepare WhatsApp message when ready." :
        "Recommendation loaded as a draft. Review it, then click Broadcast message when ready.");
    }
    let sms = { ready: false, message: "SMS connection has not been checked." };
    const originalButtonText = button?.textContent;
    const updateButton = () => {
      if (button) button.textContent = sms.mode === "whatsapp" ? "Prepare WhatsApp message" : originalButtonText;
    };
    function showWhatsAppLink(result) {
      const url = new URL(result.whatsappUrl);
      if (result.manual !== true || url.protocol !== "https:" || url.hostname !== "wa.me" || url.port ||
          !/^\/233[235]\d{8}$/.test(url.pathname)) throw new Error("A valid WhatsApp self-chat link was not confirmed.");
      report("Draft saved. Open your WhatsApp self-chat, review the advisory and tap Send. This step does not send SMS to farmers. ");
      const link = document.createElement("a");
      link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer";
      link.textContent = "Open WhatsApp";
      status?.appendChild(link);
    }
    try { pending = JSON.parse(sessionStorage.getItem("agrosync.pendingBroadcast")); } catch {}
    const fingerprint = () => JSON.stringify([region.value, locality.value.trim(), message.value.trim(), sms.mode]);
    function requestId() {
      if (!globalThis.crypto?.randomUUID) throw new Error("Open AgroSync through localhost or HTTPS to save broadcasts.");
      const content = fingerprint();
      if (!pending || pending.content !== content) pending = { content, id: crypto.randomUUID() };
      try { sessionStorage.setItem("agrosync.pendingBroadcast", JSON.stringify(pending)); } catch {}
      return pending.id;
    }
    async function updateRecipients() {
      const run = ++preview;
      if (!ready || saving) return;
      if (!region.value || !locality.value.trim()) { report("Select a region and type a locality."); return; }
      report("Checking registered recipients…");
      try {
        const farmers = await FarmerDB.getFarmersByLocality(region.value, locality.value);
        if (run !== preview || saving) return;
        const eligible = farmers.filter(farmer => farmer.whatsappOptIn === true).length;
        report((sms.mode === "whatsapp-cloud" ? eligible + " opted-in WhatsApp recipient(s), " + (farmers.length - eligible) + " other registered farmer(s) excluded. " :
          farmers.length + " registered recipient(s). ") + (sms.ready ? sms.message : "Draft saving is available. " + sms.message));
      } catch (error) { if (run === preview && !saving) report(error.message); }
    }
    function schedulePreview() {
      ++preview; clearTimeout(timer);
      if (ready && !saving) report("Checking registered recipients…");
      timer = setTimeout(updateRecipients, 350);
    }
    try {
      if (!region || !locality || !message || typeof AgroSyncBackend === "undefined" || typeof FarmerDB === "undefined") throw new Error("Broadcast scripts or fields failed to load.");
      region.replaceChildren();
      for (const name of ["", ...FarmerDB.getRegions()]) {
        const option = document.createElement("option"); option.value = name;
        option.textContent = name || "Select a region"; region.appendChild(option);
      }
      const targetChanged = () => { stopTracking(); schedulePreview(); };
      region.addEventListener("change", targetChanged);
      locality.addEventListener("input", targetChanged);
      locality.addEventListener("change", targetChanged);
      message.addEventListener("input", () => {
        stopTracking();
        messageEdited = true;
        if (messageHelp) messageHelp.textContent = defaultMessageHelp;
        if (ready && !saving && sms.mode === "whatsapp") report("Message edited. Click Prepare WhatsApp message to create an updated link.");
      });
      await AgroSyncBackend.requireAdmin();
      try { sms = await FarmerDB.getSMSStatus(); } catch (error) { sms = { ready: false, message: error.message }; }
      updateButton();
      ready = true; if (button) button.disabled = false;
      loadRecommendation();
      await updateRecipients();
      window.addEventListener("focus", () => {
        loadRecommendation();
        if (lastCloudBroadcast) { clearTimeout(deliveryTimer); trackDelivery(lastCloudBroadcast); }
        else schedulePreview();
      });
      window.addEventListener("storage", event => {
        if (event.key === "agrosync.recommendationDraft" || event.key === null) loadRecommendation();
      });
      AgroSyncBackend.getClient().auth.onAuthStateChange(event => {
        if (event === "SIGNED_OUT") { ready = false; stopTracking(); window.location.assign(AgroSyncBackend.loginPath("broadcast.html")); }
      });
    } catch (error) {
      report(error.message);
      if (/sign-in required|not authorized/i.test(error.message)) window.location.replace(AgroSyncBackend.loginPath("broadcast.html"));
    }
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!ready || saving || !form.reportValidity()) return;
      stopTracking();
      if ([...message.value.trim()].length > 1600) { report("Keep the SMS message within 1600 characters. Long messages can use multiple SMS credits."); return; }
      saving = true; ++preview; clearTimeout(timer); if (button) button.disabled = true;
      const fields = [region, locality, message];
      fields.forEach(field => { field.disabled = true; });
      report("Saving broadcast draft and recipients…");
      try {
        try { sms = await FarmerDB.getSMSStatus(); } catch (error) { sms = { ready: false, message: error.message }; }
        updateButton();
        const draft = await FarmerDB.createBroadcastDraft({ region: region.value, locality: locality.value,
          message: message.value, requestId: requestId() });
        if (!sms.ready) {
          report("Draft saved for " + draft.recipientCount + " farmer(s). " +
            (sms.mode === "whatsapp-cloud" ? "No WhatsApp message was sent. " : "No SMS was sent. ") + sms.message);
          return;
        }
        if (sms.mode === "whatsapp") {
          const handoff = await FarmerDB.sendBroadcast(draft.id, "whatsapp");
          if (handoff.mode !== "whatsapp") throw new Error("Messaging mode changed. Reload the broadcast page before continuing.");
          showWhatsAppLink(handoff);
          return;
        }
        if (sms.mode === "whatsapp-cloud") {
          let result;
          do {
            report("Submitting WhatsApp messages to eligible registered farmers…");
            result = await FarmerDB.sendBroadcast(draft.id, "whatsapp-cloud");
            if (result.mode !== "whatsapp-cloud") throw new Error("Messaging mode changed. Reload the broadcast page before continuing.");
            cloudReport(result);
          } while (result.pending > 0 && result.unknown === 0 && result.processing === 0);
          trackDelivery(draft.id);
          return;
        }
        let result;
        do {
          report((sms.mode === "sandbox" ? "Submitting a Sandbox simulation" :
            sms.mode === "android" ? "Queuing SMS on your Android phone" : "Submitting SMS to Africa's Talking") +
            " for " + draft.recipientCount + " farmer(s)…");
          result = await FarmerDB.sendBroadcast(draft.id, sms.mode);
          const notes = {
            ProviderStatus402: "Check sender ID approval for Ghana.",
            ProviderStatus405: "Top up your Africa's Talking balance.",
            ProviderHTTP401: "Check the Live application username and API key.",
            ProviderHTTP403: "Check application access and sender permissions.",
            InvalidStoredPhone: "Review invalid phone numbers in the recipient snapshot.",
            GatewayHTTP401: "Check the SMSGate username and password in .env.",
            GatewayHTTP403: "Check the SMSGate Local Server access settings.",
            GatewayFailed: "Check the phone's SMSGate message history, SIM balance and signal.",
            GatewayHTTP429: "The phone gateway is busy. Check its sending limits and message history."
          };
          report((result.mode === "sandbox" ? "Sandbox simulation: " :
            result.mode === "android" ? "Android phone submission: " : "Africa's Talking submission: ") +
            result.accepted + " accepted, " + result.failed + " failed, " + result.unknown + " uncertain, " +
            result.processing + " processing, " + result.pending + " pending. " +
            (result.mode === "sandbox" ? "No real SMS was sent. " : "Handset delivery is not yet confirmed. ") +
            (result.errors || []).map(code => notes[code] || code).join(" ") +
            (result.unknown ? (result.mode === "android" ? " Check SMSGate message history before any resend." : " Check provider reports before any resend.") : ""));
        } while (result.pending > 0 && result.unknown === 0 && result.processing === 0);
        // Keep the ID for retries/double clicks until the message or target changes.
      } catch (error) { report(error.message); }
      finally { saving = false; fields.forEach(field => { field.disabled = false; }); if (button) button.disabled = !ready; }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();

