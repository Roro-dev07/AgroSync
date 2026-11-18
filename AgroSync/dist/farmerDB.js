/**
 * Browser-local farmer registry: Region -> Locality -> Farmers.
 * All pages must use the same origin/browser profile to share localStorage.
 * This is not a server database or an SMS delivery service.
 */
"use strict";
const LocalFarmerDB = (() => {
  const STORAGE_KEY = "agro_advisory_farmer_db_v1";
  const DRAFT_KEY = "agro_advisory_broadcasts_v1";
  const LEGACY_KEY = "agrosync.farmers";
  const regionNames = Object.freeze([
    "Ahafo", "Ashanti", "Bono", "Bono East", "Central", "Eastern",
    "Greater Accra", "North East", "Northern", "Oti", "Savannah",
    "Upper East", "Upper West", "Volta", "Western", "Western North"
  ]);
  let sequence = 0;
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const dictionary = () => Object.create(null);
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  function cleanText(value, label) {
    if (typeof value !== "string" || !value.trim()) throw new Error(label + " is required.");
    const text = value.trim().replace(/\s+/g, " ");
    if (text.length > 200 || /[\u0000-\u001f\u007f]/.test(text)) throw new Error("Invalid " + label.toLowerCase() + ".");
    if (["__proto__", "constructor", "prototype"].includes(text.toLowerCase())) {
      throw new Error("Invalid " + label.toLowerCase() + ".");
    }
    return text;
  }
  function normalizeText(value) {
    return cleanText(value, "Locality").toLowerCase().replace(/\b[a-z]/g, char => char.toUpperCase());
  }
  function normalizeRegion(value) {
    const key = cleanText(value, "Region").replace(/-/g, " ").replace(/\s+/g, " ").toLowerCase();
    const name = regionNames.find(region => region.toLowerCase() === key);
    if (!name) throw new Error("Choose one of Ghana's 16 regions.");
    return name;
  }
  function normalizePhone(value) {
    let phone = cleanText(value, "Phone number").replace(/[\s().-]/g, "");
    if (/^0\d{9}$/.test(phone)) phone = "+233" + phone.slice(1);
    else if (/^233\d{9}$/.test(phone)) phone = "+" + phone;
    else if (/^00233\d{9}$/.test(phone)) phone = "+" + phone.slice(2);
    if (!/^\+233[235]\d{8}$/.test(phone)) throw new Error("Enter a valid Ghana phone number (0XXXXXXXXX or +233XXXXXXXXX).");
    return phone;
  }
  function id(prefix) {
    const unique = globalThis.crypto?.randomUUID?.() ||
      Date.now().toString(36) + "-" + (++sequence).toString(36) + "-" + Math.random().toString(36).slice(2);
    return prefix + "-" + unique;
  }
  function emptyDB() {
    return { metadata: { databaseName: "AgroAdvisory Farmer Registry", version: "1.1.0",
      lastUpdated: new Date().toISOString(), totalFarmers: 0, legacyImported: false }, regions: dictionary() };
  }
  function readJSON(key) {
    let raw;
    try { raw = localStorage.getItem(key); }
    catch { throw new Error("Cannot access browser storage. Allow site storage and try again."); }
    if (raw === null) return null;
    try { return JSON.parse(raw); }
    catch { throw new Error("Stored data is unreadable. Existing records have not been replaced; restore a valid backup."); }
  }
  function writeJSON(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); }
    catch { throw new Error("Could not save: browser storage is blocked or full. No success was recorded."); }
  }
  function all(db) {
    return Object.values(db.regions).flatMap(region => Object.values(region.localities).flat());
  }
  function makeFarmer(input, stored = false) {
    if (!object(input)) throw new Error("Invalid farmer record.");
    const firstName = cleanText(input.firstName ?? input.firstname, "First name");
    const lastName = cleanText(input.lastName ?? input.lastname, "Last name");
    if (stored && (typeof input.id !== "string" || !input.id.trim() ||
        typeof input.registeredAt !== "string" || !Number.isFinite(Date.parse(input.registeredAt)))) {
      throw new Error("Invalid farmer ID or registration date in stored data.");
    }
    return {
      id: stored ? input.id : id("FRM"), firstName, lastName, fullName: firstName + " " + lastName,
      region: normalizeRegion(input.region), locality: normalizeText(input.locality),
      phone: normalizePhone(input.phone ?? input.contact),
      registeredAt: stored ? input.registeredAt : new Date().toISOString()
    };
  }
  function insert(db, farmer) {
    if (!own(db.regions, farmer.region)) {
      db.regions[farmer.region] = { regionName: farmer.region, localities: dictionary() };
    }
    const places = db.regions[farmer.region].localities;
    if (!own(places, farmer.locality)) places[farmer.locality] = [];
    places[farmer.locality].push(farmer);
  }
  function validateDB(input) {
    if (!object(input) || !object(input.regions) || !object(input.metadata)) {
      throw new Error("Invalid farmer database structure. Existing records have not been replaced.");
    }
    const db = emptyDB();
    db.metadata = { ...db.metadata, ...input.metadata, version: "1.1.0" };
    const phones = new Set(), ids = new Set();
    for (const [regionKey, region] of Object.entries(input.regions)) {
      const name = normalizeRegion(regionKey);
      if (!object(region) || !object(region.localities)) throw new Error("Invalid locality registry.");
      for (const [localityKey, records] of Object.entries(region.localities)) {
        if (!Array.isArray(records)) throw new Error("Invalid farmer list.");
        const locality = normalizeText(localityKey);
        for (const record of records) {
          const farmer = makeFarmer(record, true);
          if (farmer.region !== name || farmer.locality !== locality) throw new Error("Farmer location does not match its registry.");
          if (phones.has(farmer.phone) || ids.has(farmer.id)) throw new Error("Duplicate farmer phone or ID in database.");
          phones.add(farmer.phone); ids.add(farmer.id); insert(db, farmer);
        }
      }
    }
    db.metadata.totalFarmers = all(db).length;
    return db;
  }
  function saveDB(db) {
    db.metadata.lastUpdated = new Date().toISOString();
    db.metadata.totalFarmers = all(db).length;
    writeJSON(STORAGE_KEY, db);
  }
  function loadDB() {
    const raw = readJSON(STORAGE_KEY);
    const db = raw === null ? emptyDB() : validateDB(raw);
    // Preserve registrations saved by the earlier script.js implementation.
    if (db.metadata.legacyImported !== true) {
      const legacy = readJSON(LEGACY_KEY);
      if (legacy !== null) {
        if (!Array.isArray(legacy)) throw new Error("Earlier farmer registrations have an invalid format.");
        const phones = new Set(all(db).map(farmer => farmer.phone));
        for (const item of legacy) {
          const farmer = makeFarmer(item);
          if (!phones.has(farmer.phone)) { insert(db, farmer); phones.add(farmer.phone); }
        }
        db.metadata.legacyImported = true;
        saveDB(db); // Never delete the old store; failures preserve it.
      }
    }
    return db;
  }
  function registerFarmer(input) {
    const farmer = makeFarmer(input);
    const db = loadDB();
    if (all(db).some(record => record.phone === farmer.phone)) {
      throw new Error("This phone number is already registered.");
    }
    if (all(db).some(record => record.id === farmer.id)) throw new Error("Farmer ID conflict. Please retry.");
    insert(db, farmer);
    saveDB(db);
    return farmer;
  }
  function getFarmersByLocality(region, locality) {
    const db = loadDB();
    return db.regions[normalizeRegion(region)]?.localities[normalizeText(locality)] || [];
  }
  function getFarmersByRegion(region) {
    const entry = loadDB().regions[normalizeRegion(region)];
    return entry ? Object.values(entry.localities).flat() : [];
  }
  function getAllFarmers() { return all(loadDB()); }
  function getHierarchy() { return loadDB().regions; }
  function getLocalitiesInRegion(region) {
    return Object.keys(loadDB().regions[normalizeRegion(region)]?.localities || {}).sort();
  }
  function deleteFarmer(farmerId) {
    const db = loadDB();
    for (const [regionKey, entry] of Object.entries(db.regions)) {
      for (const [localityKey, records] of Object.entries(entry.localities)) {
        const index = records.findIndex(farmer => farmer.id === farmerId);
        if (index === -1) continue;
        records.splice(index, 1);
        if (!records.length) delete entry.localities[localityKey];
        if (!Object.keys(entry.localities).length) delete db.regions[regionKey];
        saveDB(db);
        return true;
      }
    }
    return false;
  }
  function exportDatabaseJSON() {
    const blob = new Blob([JSON.stringify(loadDB(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "farmers_database_" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(link);
    try { link.click(); }
    finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  function importDatabaseJSON(file) {
    return new Promise((resolve, reject) => {
      if (!file) { reject(new Error("Select a database JSON file.")); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const db = validateDB(JSON.parse(reader.result));
          db.metadata.legacyImported = true;
          saveDB(db); // Validate every record before replacing any existing data.
          resolve(db);
        } catch (error) { reject(error); }
      };
      reader.onerror = reader.onabort = () => reject(new Error("Failed to read database file."));
      reader.readAsText(file);
    });
  }
  function getBroadcastDrafts() {
    const drafts = readJSON(DRAFT_KEY);
    if (drafts === null) return [];
    if (!Array.isArray(drafts) || drafts.some(draft => !object(draft) ||
        typeof draft.id !== "string" || typeof draft.message !== "string" ||
        draft.status !== "draft-not-sent" || !Array.isArray(draft.recipients))) {
      throw new Error("Stored broadcast drafts are unreadable; they have not been replaced.");
    }
    return drafts;
  }
  function createBroadcastDraft({ region, locality, message }) {
    if (typeof message !== "string" || !message.trim()) throw new Error("Enter a broadcast message.");
    const cleanRegion = normalizeRegion(region), cleanLocality = normalizeText(locality);
    // Recall current recipients at submission, not the possibly stale preview.
    const farmers = getFarmersByLocality(cleanRegion, cleanLocality);
    if (!farmers.length) throw new Error("No registered farmers in this locality.");
    const draft = {
      id: id("BCAST"), region: cleanRegion, locality: cleanLocality, message: message.trim(),
      recipients: [...new Map(farmers.map(farmer => [farmer.phone, { farmerId: farmer.id, phone: farmer.phone }])).values()],
      createdAt: new Date().toISOString(), status: "draft-not-sent"
    };
    const drafts = getBroadcastDrafts();
    writeJSON(DRAFT_KEY, [...drafts, draft]);
    return draft;
  }
  return Object.freeze({
    registerFarmer, getFarmersByLocality, getFarmersByRegion, getAllFarmers,
    getHierarchy, getLocalitiesInRegion, deleteFarmer, exportDatabaseJSON, importDatabaseJSON,
    createBroadcastDraft, getBroadcastDrafts, normalizeRegion, normalizePhone, normalizeLocality: normalizeText,
    getRegions: () => [...regionNames]
  });
})();

