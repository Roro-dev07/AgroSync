# AgroSync dashboard data and accuracy

The dashboard now separates current-weather estimates from dated NASA agricultural data. It supports all 16 Ghana regions as **capital reference points**, plus GPS or manually entered coordinates anywhere in Ghana's bounding area. A reference point is not a regional or national average.

## Why the phone comparison differed

The old dashboard displayed NASA POWER daily mean temperature and humidity, usually several days behind the current time. A phone normally shows a current estimate for its own location. Comparing a daily average at a regional capital with an instantaneous estimate at a different town does not establish an error in either source.

The revised dashboard identifies the requested coordinates, source, units, time period, and fallback on every card. Different weather providers can still disagree. Agreement with a phone is not a scientific accuracy test; validation requires matching times/locations against quality-controlled station or field measurements.

## What is implemented

| Card | Primary implementation | Meaning and limitations |
|---|---|---|
| Air temperature | Open-Meteo current 2 m temperature | Celsius; numerical weather-model estimate, not a local thermometer. NASA daily mean is an explicitly dated fallback. |
| Relative humidity | Open-Meteo current 2 m RH | Percent; timestamp matches the temperature used for the heat index. |
| Heat index | NWS/NOAA equation using concurrent temperature and RH | Degrees Celsius; derived human shaded-heat indicator. It is not a crop-specific heat-stress percentage, canopy temperature, or WBGT. |
| Previous 24 h rainfall | Sum of exactly 24 complete Open-Meteo hourly precipitation values ending at the most recent full UTC hour | Millimetres; model estimate. Missing hours invalidate the sum. Future hours are excluded. Available NASA IMERG daily rainfall is separately identified as dated agricultural context or daily fallback. |
| Evapotranspiration | NASA POWER EVPTRNS divided by 2.45 MJ/kg | Approximate daily water-depth equivalent in mm for the NASA date, not live crop water demand. The original source is an energy flux in MJ/m²/day. If unavailable, the card identifies Open-Meteo FAO-56 reference-grass ET₀ as a different model quantity. |
| Soil moisture | Valid NASA POWER RZMC or SFMC, otherwise Open-Meteo surface soil-water content | Volumetric fraction converted to percent by volume. Depth/source/date are explicit. Current model fallback is 0–1 cm; NASA root-zone moisture and surface moisture refer to different layers. POWER GWETROOT is only a final dimensionless wetness-index fallback and is never called volumetric percent. |
| Erosion screen | SRTM elevations through Open Topo Data, Horn 3×3 slope calculation at nominal 90 m spacing | Displays terrain slope in degrees, with gradient and elevation in the detail. **This is not an erosion probability, risk score, or annual soil-loss prediction.** |

The existing erosion card was explicitly renamed to distinguish a measured terrain input from an unsupported risk percentage. The heat card was similarly renamed to identify the actual derived quantity.

## NASA dataset selection for the hackathon

- **NASA POWER:** useful for historical agroclimatology, daily temperature/humidity and modelled land-water/energy fluxes. Its gridded values and processing delay make it unsuitable as an instantaneous farm weather sensor. [Meteorological sources](https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/)
- **GPM IMERG:** preferable satellite precipitation input for storm/rainfall analysis. POWER exposes a daily IMERG series; the dashboard requests it and reports its real date if valid. A daily accumulation is not a current rain rate. [NASA precipitation documentation](https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/)
- **SMAP:** appropriate satellite-based surface-soil-moisture input; L4 provides model-assimilated surface/root-zone moisture at a finer grid. POWER's documented volumetric parameters were probed, but returned fill values at the tested current reference points. The running app must therefore not label its weather-model fallback as SMAP. Dedicated SMAP extraction and quality control remain future work. [NASA hydrology sources](https://power.larc.nasa.gov/docs/methodology/data/sources_hydrology/), [SMAP latency](https://nsidc.org/data/user-resources/help-center/what-are-latencies-smap-radiometer-data-sets)
- **SRTM:** appropriate terrain input. The connected ~90 m terrain is derived from the February 2000 mission and is not a current land-cover observation. [SRTM access service](https://www.opentopodata.org/)
- **Landsat / MODIS / VIIRS:** useful for vegetation cover, crop condition and seasonal context. NDVI does not directly supply 2 m air temperature or a validated erosion probability. Integrating a vegetation/cover input into an erosion model would require an additional processing and validation workflow.
- **ECOSTRESS:** a better candidate for spatially detailed evapotranspiration and land-surface thermal stress. Its land-surface temperature is not air temperature; overpass timing, cloud/quality masks and product-specific units must be respected. It is not connected here. Earthdata/AppEEARS extraction is a separate workflow. [NASA ECOSTRESS access guide](https://github.com/nasa/ECOSTRESS-Data-Resources/blob/main/guides/appeears_ecostress.md)

A genuine erosion model additionally needs rainfall erosivity, soil erodibility, slope length/steepness, vegetation/management cover, and conservation practices. No missing factor has been invented. [USDA RUSLE](https://www.ars.usda.gov/southeast-area/oxford-ms/national-sedimentation-laboratory/watershed-physical-processes-research/docs/revised-universal-soil-loss-equation-106-description-of-rusle106c/)

## Calculation references

- [NWS heat-index algorithm](https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml?os=0): Fahrenheit-based regression with the documented low/high humidity adjustments and conversion back to Celsius.
- [FAO-56 latent-heat conversion](https://www.fao.org/4/X0490E/x0490e04.htm): approximately 2.45 MJ vaporizes 1 kg of water; 1 kg/m² equals 1 mm water depth. This conversion does not turn the NASA quantity into reference ET₀.
- [Open-Meteo variables and attribution](https://open-meteo.com/en/docs): current estimates, hourly precipitation, soil-layer definitions and reference ET₀.

## Running and verification

1. Stop the old server in the IDE terminal with Ctrl+C.
2. Run `node serve.cjs` from the AgroSync folder.
3. Open `http://127.0.0.1:5500/` and refresh with Ctrl+F5.
4. Select a reference region, click **Use my location**, or enter the farm latitude/longitude and apply.
5. Run automated checks with `node dashboard.test.cjs`.

The same-origin `/api/dashboard` route is required: a static-only server or opening index.html directly cannot run the data adapters. It uses fixed public upstreams, validates coordinates, coalesces concurrent requests, caches each source separately and labels stale fallbacks. SRTM requests are queued to respect the public test service's approximate one-request-per-second limit. A production deployment needs a hosted equivalent of this backend and an appropriately provisioned terrain source.

Live checks on 2026-11-15 returned seven numeric indicators at all 16 capital reference points. This includes **derived heat index and the slope-only erosion screen**; it is not evidence of validated field accuracy. Direct SMAP and ECOSTRESS retrieval, a calibrated erosion model, and comparison with the user's actual phone location have not been completed.

Broadcast, registration, Supabase settings, styling and the Earth background are unchanged.

