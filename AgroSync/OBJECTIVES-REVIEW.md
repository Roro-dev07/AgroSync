# AgroSync objective review

Reviewed against the supplied project objectives on 2026-11-15. The core outcome is a Ghana-focused decision-support tool for exploring crop rotations, rather than only a weather dashboard. The objectives say that the listed NASA missions and advanced analyses *may* be explored; this release uses the connected datasets and labels the remaining information gaps explicitly.

## Objective coverage

Presentation update: at the user's request, the visible comparison table, calendar panel and technical evidence panels have been replaced by one 20–150-word crop rotation suggestion card. Visible source citations and PDF links have also been removed from both guidance cards; citation metadata remains internal. The form is retained. The engine still evaluates the existing plan and alternatives internally, then uses crop family, farmer priority, water evidence and calendar context to compose one practical suggestion; this is a reviewed decision rule, not a validated optimum or ranking.

| Objective | Implemented behaviour | Limits |
|---|---|---|
| Combine NASA Earth/environmental data with local agricultural information | Existing NASA POWER/IMERG/SRTM data feed the new rotation comparison alongside reviewed MoFA and FAO guidance. | POWER meteorology is model/assimilation data, not a farm weather station; it is not labelled as SMAP or ECOSTRESS. |
| Explore soil health and resilience options | A separate dashboard planner evaluates the existing crop plan, an alternative food-crop family and a managed-cover strategy, then displays one concise suggestion. | Conditional possibilities, not a validated farm-suitability model or instruction to replace a crop. |
| Compare at least three strategies, including the existing rotation | The engine retains three distinct annual-crop sequences/management strategies internally. The current and next crop are entered by the user; no existing rotation is guessed. | The three-way table is no longer displayed, as requested. A two-crop plan does not establish the whole historical rotation. |
| Explain guidance | One short action paragraph explains the suggested sequence or cover practice, relevant water/soil checks and local review. Supporting citations remain in the reviewed engine rather than on the website cards. | No uncalibrated suitability score, expected yield, water-saving percentage, nitrogen dose or profit prediction. |
| Consider farmer priorities and local context | Main priority choices cover water, soil cover/organic matter, nitrogen fixation, erosion, forage and market diversification; optional inputs describe observed soil texture and water availability. | Farmer inputs are self-reported. A regional soil average does not become a field measurement. Market/forage suitability and budgets require local review. |
| Analyze relevant NASA patterns | Complete recent seven-day rainfall totals are compared with the preceding seven days. Same-date model rainfall and ET-equivalent totals are compared; volumetric soil-moisture and temperature means are also compared where valid. SRTM supplies a coarse slope screen. | These are recent conditions, not a climate trend, crop-water balance, forecast, disease diagnosis or measured erosion. |
| Identify possible periods of exposed ground | Farmer-entered harvest and next-sowing dates identify the interval to review for soil cover. Existing residues/living cover are respected. | This is a calendar-based opportunity check, not NDVI/bare-ground detection from satellite imagery. Cover compatibility and timing need field review. |
| Support farmer judgement and local expertise | The planner calls for local checks, discussion with a MoFA extension officer and a small trial before a whole-farm change. | No promise of a universally best rotation. |
| Handle long-lived crops appropriately | Cocoa/plantain suggestions preserve established crops and focus on suitable residues or review of planned living cover. Planned establishment is distinguished from an existing stand. | These are not presented as annual rotations. Established plantations are not instructed to be removed. |
| Keep the immediate recommendation and communications useful | The existing single 20–150-word recommendation and its automatic broadcast draft remain separate from exploratory scenarios. | Editing a scenario never replaces or sends the broadcast message. WhatsApp Cloud live delivery still requires the separate documented Meta/Supabase configuration. |

## Data actually connected

- **NASA POWER daily point API:** `https://power.larc.nasa.gov/api/temporal/daily/point`, requested in UTC. Existing parameters include temperature, humidity, corrected rainfall, IMERG precipitation when available, evaporation energy, and soil moisture/wetness. The rotation module reuses the dashboard response; it does not make extra upstream requests for each scenario.
- **GPM IMERG via POWER:** used for rainfall comparisons only when the returned daily series and units pass validation. Corrected modeled rainfall is the explicit fallback. A missing IMERG field is not silently described as satellite rainfall.
- **NASA/USGS SRTM:** the existing Open Topo Data `srtm90m` endpoint supplies elevation samples for the terrain screen. Its date and coarse sampling are distinct from current weather.
- **Open-Meteo:** remains the current-weather model for dashboard conditions. It is a non-NASA source, and its human heat-index calculation is not interpreted as crop stress.

The source missions named **SMAP, ECOSTRESS, Landsat/MODIS/VIIRS and GRACE/GRACE-FO are not newly integrated or claimed**. NASA's source documentation notes the model basis and latency of POWER meteorology; a roughly 30-day recent request is insufficient to establish long-term climate or groundwater trends. [NASA POWER daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/), [meteorological sources and latency](https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/), [SRTM provider documentation](https://www.opentopodata.org/datasets/srtm/).

## Reviewed agricultural evidence

Existing local document reviews and hashes remain in `MOFA-SOURCE-REVIEW.md` and `mofa-source-catalog.json`. Physical PDF page numbers include covers.

| Source | Passages used in the planner | Qualification |
|---|---|---|
| Supplied MoFA Maize Production Guide, 2020 | Physical p.17: crop rotation, soil testing, nutrient-management context. | Does not quantify rotation gains or justify fertilizer rates from satellite readings. |
| Supplied MoFA Tomato Production Guide, 2020 | Physical p.6: unrelated rotation examples including cereals and grain legumes. | The mixed-family example incorrectly including cassava is not propagated. Candidate crop names are discussion options, not proof that any field in Ghana suits them. |
| MoFA/CSIR Soil Nutrient Management extension manual, 2018 | Physical pp.6–7: field-specific site selection, soil protection, drainage and water management. | Supports general field checks; does not assign a soil type from a region. |
| Supplied FAO Green manure/cover crops and crop rotation in Conservation Agriculture on small farms, 2011 | Physical pp.19–20, 28, 81–83: cover, evaporation/runoff protection, compatibility, rotations and legumes. | Evidence primarily from Paraguay. Only general principles are transferred; local calendars, densities, trial yields and fertilizer equivalents are excluded. |
| Official FAO Soil organic cover webpage | Residue cover and possible between-crop cover; timely termination before competition with the next crop. | General practice, not a Ghana-specific cover species or automatic sowing date. |
| MoFA-hosted CSIR-SARI/Regional Agriculture manual, December 2017: Guidelines for Prevention of Aflatoxin Contamination in Groundnut and Maize in Ghana | Physical p.11: cereal rotation rather than repeated groundnut, moisture and field hygiene considerations. | Historical production guidance. No toxin diagnosis, chemical rate or disease threshold is inferred from live weather. |

Additional official sources reviewed for this feature:

- [FAO soil organic cover](https://www.fao.org/conservation-agriculture/in-practice/soil-organic-cover/en).
- [MoFA-hosted CSIR-SARI groundnut/maize manual](https://www.mofa.gov.gh/site/images/pdf/production_guides/Aflatoxin_Contamination_In_Groundnut_And_Maize.pdf#page=11), 23 physical pages. Source identity and rotation/moisture passages reviewed; this external PDF is not added to the user's MoFA folder or public build.

## Analysis safeguards

1. Daily values must have strict valid calendar dates, recognised units, finite values, complete UTC days and valid physical ranges. Missing/fill values are not zeros.
2. Seven-day comparisons require 14 consecutive valid days. The latest observation must be within the preceding seven days. A failed refresh marked stale disables that source's planning evidence.
3. Rainfall and water-loss comparisons use the exact same seven dates. EVPTRNS must have recognised energy-depth units and uses the existing approximate conversion of 2.45 MJ/m² per mm. This is not FAO reference crop ET or crop irrigation demand.
4. IMERG and corrected modeled rainfall are not merged into an undocumented product. If they disagree on whether the matched water-loss estimate exceeds rainfall, that inspection signal is suppressed and the disagreement is shown.
5. Root/surface volumetric moisture must be in recognised m³/m³ units and between zero and one. Wetness indices are not converted to percentages. A lower root-zone weekly mean prompts checking the field, not a crop-independent drought cutoff.
6. Daily mean temperature is shown as a recent comparison; it cannot establish frost, heat damage or human/crop heat equivalence. Extreme rain, floods and pest outbreaks are not declared from unvalidated thresholds.
7. SRTM supplies a static coarse terrain proxy. User-reported sandy/clayey texture adds field checks, not automatic crop rejection or a nutrient estimate.
8. Unconfirmed water supply or a short/unknown calendar gap does not justify adding a competing living cover. Residues and local review are the conservative starting point. A cover phase does not by itself break a same-family pest cycle.
9. Input values and rendered guidance use safe DOM text assignment. User-entered strings are validated against known choices, never inserted as executable markup. Supporting source metadata is not rendered on the guidance cards.

## Verification and boundaries

Run:

```text
node rotation-planner.test.cjs
node dashboard.test.cjs
node mofa-advisories.test.cjs
node recommendation-broadcast.test.cjs
node hosting.test.cjs
```

Rotation tests cover 726 crop/next-crop/priority combinations, source anchors, distinct annual strategies, the exact entered baseline, perennial safeguards, matched windows, missing/zero/fill values, wrong units, product disagreements, stale data, calendar validation and browser integration. They verify software behaviour, not agronomic outcomes on a specific farm.

A read-only live probe on 2026-11-15 at the Goaso reference point (6.8030, -2.5170) returned all three existing providers without errors. Valid rainfall, matched water-loss, temperature and terrain comparisons were produced. Recent volumetric NASA soil-moisture comparisons were unavailable and explicitly reported as missing. This is a connection/processing check at one point, not a field-accuracy validation or a countrywide agronomic trial.

The original logo, Earth photograph, horizontal navigation, existing metric calculations, single immediate-recommendation card, farmer registry and messaging behaviour are retained. New planning UI is a separate section as requested. No outside account, live database, broadcast recipient or public deployment is changed by this work.
