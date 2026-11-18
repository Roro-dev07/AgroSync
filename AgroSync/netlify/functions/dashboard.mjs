import dashboardModule from "../../dashboard-data.cjs";
const { createDashboardService, validateCoordinates } = dashboardModule;
const service = createDashboardService();
const json = (status, body) => new Response(JSON.stringify(body), { status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
export function createHandler(dashboard = service) {
  return async request => {
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
    const url = new URL(request.url), rawLat = url.searchParams.get("latitude"), rawLon = url.searchParams.get("longitude");
    if (!rawLat?.trim() || !rawLon?.trim()) return json(400, { error: "Latitude and longitude are required." });
    const latitude = Number(rawLat), longitude = Number(rawLon);
    try { validateCoordinates(latitude, longitude); }
    catch { return json(400, { error: "Enter coordinates within Ghana's bounding area." }); }
    try {
      const data = await dashboard.get(latitude, longitude);
      return json(Object.keys(data.sources || {}).length ? 200 : 503, data);
    } catch { return json(503, { error: "The weather data service is temporarily unavailable. Please try again shortly." }); }
  };
}
export default createHandler();
export const config = { path: "/api/dashboard" };
