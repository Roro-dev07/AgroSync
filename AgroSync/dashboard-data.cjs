/**
 * Read-only dashboard data service. Fixed upstreams only; no keys or arbitrary proxy URLs.
 * Open-Meteo: current model + hourly totals. NASA POWER: dated agricultural series.
 * NASA/USGS SRTM: terrain via Open Topo Data (not a soil-loss probability).
 */
"use strict";
const EARTH_RADIUS = 6371000;
const numeric = value => typeof value === "number" && Number.isFinite(value);
function validateCoordinates(latitude, longitude) {
  if (!numeric(latitude) || !numeric(longitude) || latitude < 4.5 || latitude > 11.3 ||
      longitude < -3.3 || longitude > 1.3) throw new Error("Enter coordinates within Ghana's bounding area.");
}
function dateKey(date) { return date.toISOString().slice(0, 10).replace(/-/g, ""); }
function terrainPoints(latitude, longitude) {
  const dy = 90 / EARTH_RADIUS * 180 / Math.PI;
  const dx = dy / Math.cos(latitude * Math.PI / 180);
  const points = [];
  for (const north of [1, 0, -1]) for (const east of [-1, 0, 1]) {
    points.push([latitude + north * dy, longitude + east * dx]);
  }
  return points;
}
function calculateTerrain(raw) {
  if (raw?.status !== "OK" || raw.results?.length !== 9 ||
      raw.results.some(point => point.dataset !== "srtm90m" || !numeric(point.elevation))) {
    throw new Error("SRTM elevations are missing or invalid at this location.");
  }
  const z = raw.results.map(point => point.elevation);
  // Horn 3x3 derivatives, nominal 90 m sample spacing in both horizontal directions.
  const dx = ((z[2] + 2*z[5] + z[8]) - (z[0] + 2*z[3] + z[6])) / (8 * 90);
  const dy = ((z[6] + 2*z[7] + z[8]) - (z[0] + 2*z[1] + z[2])) / (8 * 90);
  const gradient = Math.hypot(dx, dy);
  return { elevationMeters: z[4], slopeDegrees: Math.atan(gradient) * 180 / Math.PI,
    slopePercent: gradient * 100, resolutionMeters: 90, acquisition: "February 2000",
    source: "NASA/USGS SRTM via Open Topo Data" };
}
function createDashboardService({ fetchImpl = globalThis.fetch, now = Date.now, terrainDelay = 1100, requestTimeoutMs = 22000 } = {}) {
  const cache = new Map(), pending = new Map();
  let terrainQueue = Promise.resolve(), lastTerrain = -Infinity;
  async function json(url, signal = AbortSignal.timeout(requestTimeoutMs)) {
    const response = await fetchImpl(url, { signal });
    if (!response.ok) throw new Error("Data provider returned HTTP " + response.status + ".");
    const body = await response.json();
    if (body?.error) throw new Error(body.reason || "Data provider rejected the request.");
    return body;
  }
  async function cached(name, key, ttl, staleLimit, loader) {
    const cacheKey = name + ":" + key;
    const stored = cache.get(cacheKey), age = stored ? now() - stored.fetchedAt : Infinity;
    if (stored && age >= 0 && age < ttl) return { ...stored, cached: true, stale: false };
    if (pending.has(cacheKey)) return pending.get(cacheKey);
    if (pending.size >= 24) throw new Error("Dashboard busy; try again shortly.");
    const promise = (async () => {
      try {
        const data = await loader();
        const entry = { data, fetchedAt: now() };
        if (cache.size >= 600) cache.delete(cache.keys().next().value);
        cache.set(cacheKey, entry);
        return { ...entry, cached: false, stale: false };
      } catch (error) {
        if (stored && age >= 0 && age < staleLimit) return { ...stored, cached: true, stale: true,
          warning: "Refresh failed; showing dated cached data." };
        throw error;
      }
    })();
    pending.set(cacheKey, promise);
    try { return await promise; } finally { pending.delete(cacheKey); }
  }
  function terrain(latitude, longitude) {
    // Public testing service permits approximately one upstream call per second.
    // Include queue time in the deadline so a slow terrain call cannot time out
    // the hosted function after weather and NASA data have already succeeded.
    const signal = AbortSignal.timeout(requestTimeoutMs);
    const task = terrainQueue.then(async () => {
      signal.throwIfAborted();
      const wait = Math.max(0, terrainDelay - (now() - lastTerrain));
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      signal.throwIfAborted();
      lastTerrain = now();
      const points = terrainPoints(latitude, longitude).map(point => point.map(n => n.toFixed(6)).join(",")).join("|");
      const query = new URLSearchParams({ locations: points, interpolation: "bilinear" });
      return calculateTerrain(await json("https://api.opentopodata.org/v1/srtm90m?" + query, signal));
    });
    terrainQueue = task.catch(() => {});
    return new Promise((resolve, reject) => {
      const abort = () => reject(new Error("Terrain request timed out; other data sources can still load."));
      signal.addEventListener("abort", abort, { once: true });
      task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }
  async function get(latitude, longitude) {
    validateCoordinates(latitude, longitude);
    // Match the requested coordinates to cache precision before querying.
    latitude = Number(latitude.toFixed(4)); longitude = Number(longitude.toFixed(4));
    const key = latitude + "," + longitude;
    const weatherQuery = new URLSearchParams({
      latitude, longitude, current: "temperature_2m,relative_humidity_2m",
      hourly: "precipitation,soil_moisture_0_to_1cm,et0_fao_evapotranspiration",
      past_days: "2", forecast_days: "1", timezone: "UTC",
      temperature_unit: "celsius", precipitation_unit: "mm"
    });
    const end = new Date(now()); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate()-1);
    const start = new Date(end); start.setUTCDate(start.getUTCDate()-29);
    const nasaQuery = new URLSearchParams({
      parameters: "T2M,RH2M,PRECTOTCORR,EVPTRNS,GWETROOT,SFMC,RZMC,IMERG_PRECTOT",
      community: "AG", latitude, longitude, start: dateKey(start), end: dateKey(end),
      format: "JSON", "time-standard": "UTC"
    });
    const tasks = {
      weather: () => cached("weather", key, 10*60000, 60*60000, async () => {
        const data = await json("https://api.open-meteo.com/v1/forecast?" + weatherQuery);
        if (!data.current || !data.hourly?.time?.length) throw new Error("Current-weather response is incomplete.");
        return data;
      }),
      nasa: () => cached("nasa", key, 3*3600000, 7*86400000, async () => {
        const data = await json("https://power.larc.nasa.gov/api/temporal/daily/point?" + nasaQuery);
        if (!data.properties?.parameter) throw new Error("NASA POWER response is incomplete.");
        return data;
      }),
      terrain: () => cached("terrain", key, 30*86400000, 365*86400000, () => terrain(latitude, longitude))
    };
    const entries = Object.entries(tasks);
    const results = await Promise.allSettled(entries.map(([,task]) => task()));
    const sources = {}, errors = {};
    results.forEach((result, i) => {
      const name = entries[i][0];
      if (result.status === "fulfilled") sources[name] = result.value;
      else errors[name] = result.reason?.message || "Source unavailable.";
    });
    return { coordinates: { latitude, longitude }, generatedAt: now(), sources, errors };
  }
  return { get };
}
module.exports = { createDashboardService, calculateTerrain, terrainPoints, validateCoordinates };

