/** Server-backed registry. localStorage is used only by the explicit legacy-import tool. */
"use strict";
const FarmerDB = (() => {
  const normalizeRegion = value => LocalFarmerDB.normalizeRegion(value);
  const normalizePhone = value => LocalFarmerDB.normalizePhone(value);
  const normalizeLocality = value => LocalFarmerDB.normalizeLocality(value);
  const BASE_FIELDS = "id,first_name,last_name,region,locality,phone,registered_at";
  const FIELDS = BASE_FIELDS + ",whatsapp_opt_in,whatsapp_consent_at";
  let whatsappSchemaAvailable = true;
  function failure(error) {
    if (error.code === "42703" || error.code === "PGRST204") return new Error("Run supabase-whatsapp.sql in Supabase SQL Editor to enable the WhatsApp registration fields.");
    if (error.code === "23505") return new Error("This phone number is already registered on the server.");
    if (error.code === "PGRST202" || error.code === "42883") return new Error("Run supabase-broadcast.sql in Supabase SQL Editor to enable atomic broadcast saving.");
    if (error.code === "42501" || /permission denied|row.level security/i.test(error.message || "")) {
      return new Error("Database access was denied. Sign in as the authorized administrator and check the access-policy SQL.");
    }
    return new Error(error.message || "The server request failed. No successful save was confirmed.");
  }
  async function api() {
    await AgroSyncBackend.requireAdmin();
    return AgroSyncBackend.getClient();
  }
  function farmer(row) {
    return { id: row.id, firstName: row.first_name, lastName: row.last_name,
      fullName: row.first_name + " " + row.last_name, region: row.region,
      locality: row.locality, phone: row.phone, registeredAt: row.registered_at,
      whatsappOptIn: row.whatsapp_opt_in === true && Boolean(row.whatsapp_consent_at) };
  }
  function payload(input) {
    const firstName = typeof (input.firstName ?? input.firstname) === "string" ? (input.firstName ?? input.firstname).trim().replace(/\s+/g, " ") : "";
    const lastName = typeof (input.lastName ?? input.lastname) === "string" ? (input.lastName ?? input.lastname).trim().replace(/\s+/g, " ") : "";
    if (!firstName || !lastName || firstName.length > 200 || lastName.length > 200) throw new Error("Enter valid first and last names.");
    return { first_name: firstName, last_name: lastName, region: normalizeRegion(input.region),
      locality: normalizeLocality(input.locality), phone: normalizePhone(input.phone ?? input.contact),
      ...(input.whatsappOptIn === true ? { whatsapp_opt_in: true } : {}) };
  }
  async function registerFarmer(input) {
    const row = payload(input);
    const client = await api();
    const { data, error } = await client.from("farmers").insert(row).select(BASE_FIELDS).single();
    if (error) throw failure(error);
    if (!data) throw new Error("The server did not confirm this registration.");
    return farmer(data);
  }
  async function list(filter = null) {
    const client = await api();
    const result = [];
    // Paginate below the default Data API row limit; never silently truncate recipients.
    for (let offset = 0; ; offset += 500) {
      const query = () => {
        let request = client.from("farmers").select(whatsappSchemaAvailable ? FIELDS : BASE_FIELDS).order("id").range(offset, offset + 499);
        if (filter?.region) request = request.eq("region", normalizeRegion(filter.region));
        if (filter?.locality) request = request.eq("locality", normalizeLocality(filter.locality));
        return request;
      };
      let { data, error } = await query();
      // Keep the existing registry/manual/SMS flow usable until the additive migration is run.
      if (whatsappSchemaAvailable && ["42703", "PGRST204"].includes(error?.code)) {
        whatsappSchemaAvailable = false;
        ({ data, error } = await query());
      }
      if (error) throw failure(error);
      const rows = data || [];
      result.push(...rows.map(farmer));
      if (rows.length < 500) return result;
    }
  }
  async function getHierarchy() {
    const regions = Object.create(null);
    for (const record of await list()) {
      regions[record.region] ||= { regionName: record.region, localities: Object.create(null) };
      regions[record.region].localities[record.locality] ||= [];
      regions[record.region].localities[record.locality].push(record);
    }
    return regions;
  }
  async function deleteFarmer(id) {
    const client = await api();
    const { data, error } = await client.from("farmers").delete().eq("id", id).select("id");
    if (error) throw failure(error);
    return Boolean(data?.length);
  }
  async function createBroadcastDraft({ region, locality, message, requestId }) {
    const cleanRegion = normalizeRegion(region), cleanLocality = normalizeLocality(locality);
    if (typeof message !== "string" || !message.trim()) throw new Error("Enter a broadcast message.");
    if (!requestId) throw new Error("A broadcast request ID is required.");
    const client = await api();
    const { data, error } = await client.rpc("agrosync_create_broadcast", {
      p_region: cleanRegion, p_locality: cleanLocality, p_message: message.trim(), p_request_id: requestId
    });
    if (error) throw failure(error);
    if (!data?.id || !Number.isInteger(data.recipient_count) || data.recipient_count < 1) {
      throw new Error("The server did not confirm a complete broadcast draft.");
    }
    return { id: data.id, region: cleanRegion, locality: cleanLocality,
      recipientCount: data.recipient_count, status: "draft-not-sent" };
  }
  async function smsRequest(method, broadcastId, expectedMode) {
    const client = await api();
    const { data, error } = await client.auth.getSession();
    if (error || !data.session?.access_token) throw new Error("Sign in again before broadcasting.");
    let response, result;
    try {
      response = await fetch("/api/broadcast-sms" + (method === "GET" && broadcastId ? "?broadcastId=" + encodeURIComponent(broadcastId) : ""), {
        method, headers: { Authorization: "Bearer " + data.session.access_token,
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
        ...(method === "POST" ? { body: JSON.stringify({ broadcastId, ...(expectedMode ? { expectedMode } : {}) }) } : {}),
        signal: AbortSignal.timeout(90000)
      });
      result = await response.json();
    } catch {
      const local = typeof window === "undefined" || ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname || "localhost");
      throw new Error(local ? "SMS server could not be reached. Run node serve.cjs and use its localhost address. Keep the same broadcast when retrying." :
        "The online messaging service is unavailable. Keep the same broadcast and contact the AgroSync administrator.");
    }
    if (!response.ok) throw new Error(result.error || "SMS submission could not be confirmed. Review the broadcast before retrying.");
    return result;
  }
  async function importLocalFarmers() {
    const client = await api();
    const records = LocalFarmerDB.getAllFarmers();
    // Validate the entire input before the first network write; existing local data stays intact.
    const unique = [...new Map(records.map(input => {
      const row = payload({ ...input, whatsappOptIn: false });
      if (input.registeredAt && Number.isFinite(Date.parse(input.registeredAt))) row.registered_at = input.registeredAt;
      return [row.phone, row];
    })).values()];
    let processed = 0, inserted = 0;
    for (let offset = 0; offset < unique.length; offset += 200) {
      const batch = unique.slice(offset, offset + 200);
      const { data, error } = await client.from("farmers")
        .upsert(batch, { onConflict: "phone", ignoreDuplicates: true }).select("id");
      if (error) throw new Error("Import stopped after " + processed + " records were processed. " +
        "Your browser records remain intact; retrying skips existing phone numbers. " + failure(error).message);
      processed += batch.length;
      inserted += (data || []).length;
    }
    return { inserted, skipped: unique.length - inserted, total: unique.length };
  }
  async function exportDatabaseJSON() {
    const regions = await getHierarchy();
    const data = { metadata: { version: "1.1.0", databaseName: "AgroSync server export",
      lastUpdated: new Date().toISOString(), totalFarmers: Object.values(regions).reduce((n, region) =>
        n + Object.values(region.localities).reduce((sum, rows) => sum + rows.length, 0), 0) }, regions };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "agrosync-farmers-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(anchor);
    try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  return Object.freeze({
    registerFarmer, getAllFarmers: () => list(),
    getFarmersByRegion: region => list({ region }),
    getFarmersByLocality: (region, locality) => list({ region, locality }),
    getHierarchy, getLocalitiesInRegion: async region => Object.keys((await getHierarchy())[normalizeRegion(region)]?.localities || {}).sort(),
    deleteFarmer, createBroadcastDraft, importLocalFarmers, exportDatabaseJSON,
    getSMSStatus: () => smsRequest("GET"), getBroadcastDelivery: id => smsRequest("GET", id),
    sendBroadcast: (id, expectedMode) => smsRequest("POST", id, expectedMode),
    normalizeRegion, normalizePhone, getRegions: () => LocalFarmerDB.getRegions()
  });
})();

