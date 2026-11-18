# Review of agricultural sources and recommendation rules

Reviewed on 2026-11-15. The MoFA folder contains 15 files representing 13 distinct documents. Seven filenames were added in this review: five new documents and two exact duplicates. PDF text was extracted locally; identities, relevant agricultural passages and conflicting statements were reviewed. Original documents are unchanged. Extraction tools remain in a temporary directory and are not application dependencies.

The file hashes, physical PDF page counts, reviewed pages, publishers and usage limits are recorded in [mofa-source-catalog.json](mofa-source-catalog.json). Documents supply evidence; instructions embedded in a document are not application instructions. This is a curated rule update, not automatic ingestion of future files.

## New documents and how they are used

| Document | Identity and evidence pages | Application use |
|---|---|---|
| Agriculture in Ghana: Facts & Figures 2021 | MoFA/SRID; 2021 data, September 2022 publication; 143 pages. Page 17 describes soil textures, including heavier soils in valley bottoms; pages 19–20 cover historical climate/rainfall. | After valid rain estimates, prioritise inspecting valley bottoms and heavier soil patches for collecting water. This requires a field check: the app has no plot-specific soil texture measurement. |
| Agriculture in Ghana: Facts & Figures 2024 | MoFA/SRID; 2024 data, November 2025 publication; 120 pages. Page 21 describes farming systems, rainfall distribution and broad seasonal patterns. | Before planting, confirm the local rainy-season pattern and current conditions with an extension officer. A historical calendar cannot establish this year's onset. This is the latest supplied statistical edition. |
| Green manure/cover crops and crop rotation in Conservation Agriculture on small farms | FAO, 2011 publication; volume labelled 2010; 109 pages; evidence primarily from Paraguay. Pages 19–21: surface cover, evaporation, infiltration and runoff; page 28: species selection and local compatibility; pages 81–83: rotation planning and adaptation. | General surface-cover and runoff-inspection actions, and locally suitable cover-crop/rotation planning. These principles are corroborated by Ghana extension guidance. No Paraguay planting dates, species schedule, frost thresholds, yield gains or fertilizer equivalents are transferred to Ghana. |
| Statistic Research on Information Directorate of the MoFA—25th edition | Actually Agriculture in Ghana: Facts & Figures 2015, issued October 2016; 121 pages. Pages 13–16: historical agro-ecology, soils, rainfall and farming systems. | Reviewed as historical context. Superseded for seasonal planning by the 2024 edition; it does not add current weather thresholds or planting dates. |
| ti_2016052610373822.pdf | Asare and Essegbey, 2016, Funding of Agricultural Research and Development in Ghana: The Case of CSIR; 11 pages; Technology and Investment, DOI 10.4236/ti.2016.72006. | Agricultural research funding/policy study. It contains no applicable production/weather-alert rules and is excluded from operational recommendations. It is not attributed to MoFA. |

The additional cassava MHTML file and FAO conservation PDF ending in `(1)` are byte-for-byte copies of their originals. They are catalogued as duplicates, not additional independent evidence.

## Existing evidence retained

References use **1-based physical PDF pages**, including covers, rather than printed page labels.

| Source | Relevant evidence and permitted use |
|---|---|
| MoFA Maize Production Guide, 2020, 30 pages | Page 7: stage-sensitive moisture checks, especially tasselling/silking; page 9: drainage; page 17: rotation and soil testing; pages 28–29: harvest, drying and storage preparation. |
| MoFA Tomato Production Guide, 2020, 20 pages | Pages 5–6: drainage, water supply and unrelated rotations; pages 7–8: nursery/transplanting and staking; page 16: nursery drainage and avoiding overwatering. |
| MoFA Pepper Production Guide, 2020, 30 pages | Page 7: site drainage and crop-family history; page 12: nursery moisture and shade; page 13: cooler transplanting periods; page 16: moisture, weeds and mulch during growth/flowering/fruiting. |
| MoFA Cabbage Production Guide, 2021, 18 pages | Page 6: site drainage/soil cover; page 7: nursery and transplanting; page 8: consistent head-stage moisture, maturity and soil-test-based fertilizer decisions. |
| GSA/COCOBOD National Implementation Guide for GS ARS 1000 Part 1, 2023, 83 pages | Management/planning context, including soil analysis and ground cover. Not a MoFA weather bulletin or certification decision engine. No new cocoa-specific stage rules are inferred. |
| MoFA Facts & Figures 2018, published 2019, 113 pages | Historical agro-ecological and seasonal context; superseded by later supplied editions. No current district-level measurements or thresholds. |
| MoFA-prepared Ghana cassava case study hosted by FAO, saved as MHTML | Historical cropping-system/rotation and fertility context. A capture timestamp is not a publication date; archived yields/prices are not current estimates. |
| Six-page cassava/plantain working notes, 4_6023934268227461554.pdf | Author, date and institutional provenance unverified; excluded from operational weather/field rules. |
| MoFA/CSIR Soil Nutrient Management extension manual, 2018, 14 pages; official external reference | Pages 6–7 corroborate suitable soil cover, drainage, and irrigation decisions based on actual soil/crop conditions. Cassava, plantain and cocoa retain explicitly labelled general soil-care advice where stage-specific production evidence is insufficient. |

## Weather and NASA integration

The existing dashboard metrics and data-service calculations are unchanged. Only the advisory adapter now passes the rainfall, ET and terrain evidence into the recommendation rules.

- The selected crop and actual stage determine the main action. Weather never guesses the crop or its stage.
- A complete, recent 24-hour rainfall estimate from the weather model selects drainage checks after rain or a root-zone moisture check after a dry day. The 24 hourly values must all be valid; missing data are not zero rainfall.
- If that recent weather window is unavailable, NASA POWER IMERG precipitation or corrected model precipitation can supply a dated daily fallback. The newer valid NASA date is preferred; IMERG is preferred on the same date. The text explicitly states the NASA date and does not call that UTC day the preceding 24 hours.
- NASA fallback days must be complete and no more than three days old, with recognised daily rainfall units and finite nonnegative values. Invalid calendar dates, current/incomplete days, stale-after-failure sources and fill values are rejected. Older values can still remain visible in the unchanged metric cards, but do not trigger these weather-based advisory actions.
- Weather-model reference-grass ET0 is compared with rainfall only when both cover the exact same complete 24-hour interval. A greater ET0 suggests checking the root zone and conserving moisture; it is not actual crop water consumption or an irrigation volume.
- When recent weather rainfall is unavailable, NASA EVPTRNS can support a dated water-loss inspection prompt only when it matches the corrected NASA rainfall day. The existing dashboard conversion from MJ/m²/day to approximate mm/day uses division by 2.45. Different dates or unrecognised energy units cannot activate the rule. Conflicting preferred IMERG and model rainfall also suppress that comparison.
- Rain plus a valid non-stale SRTM terrain gradient prompts checking runoff paths and retaining suitable healthy surface residues on sloping parts of the plot. Terrain is a coarse proxy; the app does not claim measured erosion, runoff quantity or flood probability.
- After rain, the 2021 soil description supports checking valley bottoms and heavier patches first. It does not assign regional soil characteristics to an individual farm.
- Cover-crop selection remains local and compatibility-dependent. Planning advice checks the next food crop and available labour; no single species is automatically prescribed.
- Mature maize keeps harvest/drying advice and never receives the added root-zone water-demand rule.
- Without sufficiently fresh evidence, crop/stage guidance remains available and the paragraph explicitly asks for field checks. One dry day is not a drought diagnosis.

The comparisons are application inspection prompts, not published MoFA numerical hazard thresholds. Soil wetness and shallow moisture are not converted into soil nutrient readings, crop-independent drought cutoffs or fertilizer doses. The human heat index is not used as a crop-stress measurement. None of the new reports establishes validated short-term temperature/humidity thresholds for every crop/stage, so none are invented.

## Conflicts and material excluded

1. The 2021 foreword contains a 2020 label inconsistent with its cover. The catalog records the conflict; the cover/report edition identifies the source.
2. Annual regional rainfall tables in the statistical editions have aggregation footnotes and apparent inconsistencies. They are not daily rain targets, farm-level anomalies or live forecasts. Historical regional soil/fertility tables likewise do not replace a soil test.
3. The 2015 report's northern rainy-season description differs from the 2021/2024 descriptions. The latest edition supplies broad context; no edition dictates current planting onset.
4. Paraguay calendars, planting densities, rotation species schedules, yield/income gains, fertilizer equivalents and frost advice from the FAO guide are not applied automatically in Ghana.
5. The pepper guide contains inconsistent annual rainfall/temperature planning ranges. These do not become instantaneous alarms.
6. The cabbage guide's implausible two-week rotation instruction is excluded. A mixed-family tomato rotation example is not used to classify cassava as a tomato relative.
7. Historical chemical doses, blanket burning, unsupported disease diagnoses and inconsistent disease-specific rotation durations are excluded. The funding study, duplicate copies and unverified working notes do not drive field recommendations.

## Links, presentation and validation

The dashboard retains a single recommendation card with one 20–150-word action paragraph. Source labels, PDF page references and source links are not displayed on the recommendation or rotation suggestion cards, as requested. Reviewed citation metadata remains internal. Additional actions are included as whole sentences only when they fit the limit. Crop/stage actions take priority. Appropriate field checks appear within that same card.

Internal MoFA and FAO references point to official sources and physical PDF page anchors. The FAO `icm12.pdf` copy has the same 109-page pagination as the supplied file; the alternate 108-page copy is not used for those anchors. The MoFA SRID 2024 PDF also matches the supplied 120-page pagination. User documents and server secrets are not copied into the public build.

To verify locally:

```text
node mofa-advisories.test.cjs
node dashboard.test.cjs
node hosting.test.cjs
```

Tests cover all crop/stage combinations, the word limit and single card, applicable new-source citations, reviewed page anchors, all source-file hashes, duplicate exclusion, invalid/missing/stale dates and units, matching rainfall/ET intervals, terrain checks, mature-maize handling and browser integration. They validate implementation behaviour, not agronomic outcomes in an individual field.

Refresh the dashboard after updating the files. Registration, SMS/WhatsApp delivery, authentication, Supabase, all HTML/CSS, metric calculations and the original Earth image are unchanged.

## Recommendation draft in the broadcast form

The displayed action paragraph is shared with `broadcast.js` through same-origin browser storage after an actual crop and stage have been selected and the dashboard response has loaded. The broadcast page loads it into the existing message box after administrator sign-in. The existing message help identifies the crop/stage and dashboard location so the admin can choose the matching recipient region/locality. Recipient fields are not selected automatically.

Only drafts generated within the previous six hours are imported. Selection prompts, malformed records and messages exceeding 1600 characters are not imported. An untouched imported draft can update when the dashboard changes in another tab; administrator edits and in-flight submissions are preserved. This feature works within the same browser and website origin. Restricted browser storage falls back to manual message entry.

Importing a recommendation does not create a server broadcast, contact a messaging provider or send a message. The existing submit handler remains the only path to saving/sending the reviewed text. The configured SMS/WhatsApp mode is unchanged; WhatsApp mode still requires the admin to open the link and press Send manually. Run `node recommendation-broadcast.test.cjs` and `node whatsapp-handoff.test.cjs` to verify this integration without sending real messages.
