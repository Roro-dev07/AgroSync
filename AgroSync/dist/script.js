/**
 * AgroSync: point-based Ghana dashboard.
 * Each metric declares its own source, units and observation/model time.
 * Current model != weather-station observation. NASA data retain their actual dates.
 */
"use strict";
const AgroDashboard = (() => {
  const REGIONS = {
    ahafo: ["Ahafo","Goaso",6.803,-2.517], ashanti: ["Ashanti","Kumasi",6.6885,-1.6244],
    bono: ["Bono","Sunyani",7.3399,-2.3268], "bono-east": ["Bono East","Techiman",7.5907,-1.9344],
    central: ["Central","Cape Coast",5.1053,-1.2466], eastern: ["Eastern","Koforidua",6.0941,-0.2591],
    "greater-accra": ["Greater Accra","Accra",5.6037,-0.187], northern: ["Northern","Tamale",9.4034,-0.8424],
    "north-east": ["North East","Nalerigu",10.527,-0.369], oti: ["Oti","Dambai",8.0667,0.1833],
    savannah: ["Savannah","Damongo",9.0833,-1.8167], "upper-east": ["Upper East","Bolgatanga",10.7856,-0.8514],
    "upper-west": ["Upper West","Wa",10.0601,-2.5099], volta: ["Volta","Ho",6.6111,0.47],
    western: ["Western","Sekondi-Takoradi",4.934,-1.7137], "western-north": ["Western North","Sefwi Wiawso",6.207,-2.489]
  };
  const IDS = ["temp","humidity","heatStress","rainfall","evapotranspiration","moisture","erosion"];
  const advisoryEngine = typeof MoFAAdvisories !== "undefined" ? MoFAAdvisories :
    typeof require === "function" ? require("./mofa-advisories.js") : null;
  const rotationPlanner = typeof AgroRotationPlanner !== "undefined" ? AgroRotationPlanner :
    typeof require === "function" ? require("./rotation-planner.js") : null;
  let latestAdvisoryPayload = null;
  let latestAdvisoryPoint = null;
  const numeric = value => typeof value === "number" && Number.isFinite(value);
  const hour = 3600000, day = 24*hour;
  const byId = id => document.getElementById(id);
  const stamp = time => new Date(time).toISOString().slice(0,16).replace("T"," ") + " UTC";
  function parseTime(text) {
    if (typeof text !== "string") return NaN;
    return Date.parse(/[zZ]$|[+-]\d\d:\d\d$/.test(text) ? text : text + "Z");
  }
  function validCoordinates(lat, lon) {
    return numeric(lat) && numeric(lon) && lat >= 4.5 && lat <= 11.3 && lon >= -3.3 && lon <= 1.3;
  }
  function latestNASA(raw, key, now = Date.now(), maxAgeDays = 7) {
    const values = raw?.properties?.parameter?.[key];
    if (!values || typeof values !== "object") return null;
    for (const date of Object.keys(values).filter(key => /^\d{8}$/.test(key)).sort().reverse()) {
      const iso = date.slice(0,4)+"-"+date.slice(4,6)+"-"+date.slice(6,8);
      const time = Date.parse(iso+"T00:00:00Z"), value = values[date];
      if (!Number.isFinite(time) || new Date(time).toISOString().slice(0,10) !== iso) continue;
      if (!numeric(value) || value === -999 || value === raw.header?.fill_value || time > now ||
          now-time > maxAgeDays*day) continue;
      if (["RZMC","SFMC","GWETROOT"].includes(key) && (value<0 || value>1)) continue;
      if (["EVPTRNS","PRECTOTCORR","IMERG_PRECTOT"].includes(key) && value<0) continue;
      if (key==="RH2M" && (value<0 || value>100)) continue;
      return { value, date:iso, time, unit:raw.parameters?.[key]?.units };
    }
    return null;
  }
  function rolling24Hours(raw, key, now = Date.now()) {
    if (raw?.hourly_units?.[key] !== "mm") return null;
    const end = Math.floor(now/hour)*hour, times = raw.hourly?.time, values = raw.hourly?.[key];
    if (!Array.isArray(times) || !Array.isArray(values)) return null;
    const rows = times.map((time,i) => ({ time:parseTime(time), value:values[i] }))
      .filter(row => row.time > end-day && row.time <= end).sort((a,b)=>a.time-b.time);
    if (rows.length !== 24 || rows.some((row,i)=>!numeric(row.value) || row.value<0 || row.time !== end-(23-i)*hour)) return null;
    return { value: rows.reduce((sum,row)=>sum+row.value,0), start:end-day, end };
  }
  function currentWeather(raw, now = Date.now()) {
    const time = parseTime(raw?.current?.time);
    if (!Number.isFinite(time) || time > now+30*60000 || now-time > 6*hour) return null;
    const temperature = raw.current.temperature_2m, humidity = raw.current.relative_humidity_2m;
    return { time,
      temperature: raw.current_units?.temperature_2m === "°C" && numeric(temperature) && temperature>=-40 && temperature<=60 ? temperature : null,
      humidity: raw.current_units?.relative_humidity_2m === "%" && numeric(humidity) && humidity>=0 && humidity<=100 ? humidity : null };
  }
  function modelSoil(raw, now = Date.now()) {
    if (raw?.hourly_units?.soil_moisture_0_to_1cm !== "m³/m³") return null;
    const times=raw.hourly?.time, values=raw.hourly?.soil_moisture_0_to_1cm;
    if (!Array.isArray(times) || !Array.isArray(values)) return null;
    for (let i=times.length-1;i>=0;i--) {
      const time=parseTime(times[i]), value=values[i];
      if (time<=now && now-time<=2*hour && numeric(value) && value>=0 && value<=1) return {value,time};
    }
    return null;
  }
  function nasaET(raw, now = Date.now()) {
    const row=latestNASA(raw,"EVPTRNS",now);
    if (!row || !["MJ/m^2/day","MJ/m2/day"].includes(row.unit?.replace(/\s/g,""))) return null;
    // 2.45 MJ/kg latent heat; 1 kg/m² liquid water equals 1 mm depth (FAO-56).
    return { ...row, value: row.value/2.45, energy:row.value };
  }
  function heatIndexC(temperature, humidity) {
    if (!numeric(temperature) || !numeric(humidity) || temperature<0 || temperature>50 || humidity<0 || humidity>100) return null;
    const t=temperature*9/5+32, r=humidity;
    let index=0.5*(t+61+(t-68)*1.2+r*0.094);
    index=(index+t)/2;
    if(index>=80) {
      index=-42.379+2.04901523*t+10.14333127*r-0.22475541*t*r-0.00683783*t*t-
        0.05481717*r*r+0.00122874*t*t*r+0.00085282*t*r*r-0.00000199*t*t*r*r;
      if(r<13 && t>=80 && t<=112) index-=((13-r)/4)*Math.sqrt((17-Math.abs(t-95))/17);
      else if(r>85 && t>=80 && t<=87) index+=((r-85)/10)*((87-t)/5);
    }
    return (index-32)*5/9;
  }
  function setText(id,text) { const node=byId(id); if(node) node.textContent=text; }
  function metric(id,title,value,detail,note,progress=null) {
    const display=byId(id+"-display"), heading=display?.closest(".card")?.querySelector("h3");
    if(heading) heading.textContent=title;
    setText(id+"-display",value); setText(id+"-detail",detail); setText(id+"-trend",note);
    const bar=byId(id+"-bar");
    if(bar)bar.style.width=(numeric(progress)?Math.max(0,Math.min(100,progress)):0)+"%";
  }
  function clear(message) {
    for(const id of IDS) {
      setText(id+"-display","—"); setText(id+"-detail",message); setText(id+"-trend","Awaiting source");
      const bar=byId(id+"-bar");if(bar)bar.style.width="0%";
    }
  }
  function notice(container,title,text,type="info",link=null) {
    const block=document.createElement("div"),heading=document.createElement("strong"),body=document.createElement("p");
    block.className="alert alert-"+type;heading.textContent=title;body.textContent=text;block.append(heading,body);
    if(link){const anchor=document.createElement("a");anchor.href=link.url;anchor.textContent=link.text;block.append(anchor);}
    container.append(block);
  }
  function renderAdvisories(payload=latestAdvisoryPayload,now=Date.now()) {
    const container=byId("recommendations-container");
    if(!container)return;
    if(!advisoryEngine) {
      container.replaceChildren();
      notice(container,"Guidance unavailable","The recommendation could not load. Refresh the dashboard to try again, then choose your crop and its actual growth stage for guidance.","warning");
      return;
    }
    const weather=payload?.sources?.weather?.data;
    const nasa=payload?.sources?.nasa?.data,et=nasaET(nasa,now);
    const recommendations=advisoryEngine.generate({
      crop:byId("advisory-crop")?.value||"general",
      stage:byId("advisory-stage")?.value||"unspecified",
      rain24:rolling24Hours(weather,"precipitation",now),
      referenceET24:rolling24Hours(weather,"et0_fao_evapotranspiration",now),
      weatherStale:!payload?.sources?.weather||Boolean(payload.sources.weather.stale),
      nasaDaily:{satelliteRain:latestNASA(nasa,"IMERG_PRECTOT",now),modelRain:latestNASA(nasa,"PRECTOTCORR",now),
        evapotranspiration:et?{value:et.value,date:et.date,unit:"mm/day"}:null},
      nasaStale:!payload?.sources?.nasa||Boolean(payload.sources.nasa.stale),
      terrainGradient:payload?.sources?.terrain?.data?.slopePercent,
      terrainStale:!payload?.sources?.terrain||Boolean(payload.sources.terrain.stale),
      now
    });
    advisoryEngine.render(container,recommendations);
    // Share the displayed action paragraph with the broadcast page, never submit it.
    const recommendation=recommendations[0];
    try {
      if(payload&&recommendation?.crop!=="general"&&recommendation?.stage!=="unspecified"&&recommendation?.text) {
        localStorage.setItem("agrosync.recommendationDraft",JSON.stringify({
          version:1,text:recommendation.text,title:recommendation.title,
          location:latestAdvisoryPoint?latestAdvisoryPoint.name+" ("+latestAdvisoryPoint.latitude.toFixed(4)+", "+latestAdvisoryPoint.longitude.toFixed(4)+")":"",
          generatedAt:now
        }));
      } else localStorage.removeItem("agrosync.recommendationDraft");
    } catch {} // Restricted browser storage must not break the dashboard.
  }
  function render(payload,point,now=Date.now()) {
    latestAdvisoryPayload=payload;
    latestAdvisoryPoint=point;
    rotationPlanner?.update(payload,point,now);
    renderAdvisories(payload,now);
    const sources=payload.sources||{},weather=sources.weather?.data,nasa=sources.nasa?.data,terrain=sources.terrain?.data;
    const current=currentWeather(weather,now),soil=modelSoil(weather,now),rain=rolling24Hours(weather,"precipitation",now);
    const rainNASA=latestNASA(nasa,"IMERG_PRECTOT",now)||latestNASA(nasa,"PRECTOTCORR",now);
    const root=latestNASA(nasa,"RZMC",now),surface=latestNASA(nasa,"SFMC",now),wetness=latestNASA(nasa,"GWETROOT",now);
    const nasaMoisture=[root,surface].find(row=>row && ["m3m-3","m^3/m^3","m³/m³"].includes(row.unit?.replace(/\s/g,"")));
    const et=nasaET(nasa,now),referenceET=rolling24Hours(weather,"et0_fao_evapotranspiration",now);
    const sourceNote=name=>sources[name]?.stale?"Cached source; refresh failed":"Source date shown above";
    if(numeric(current?.temperature)) {
      metric("temp","Air temperature",current.temperature.toFixed(1)+"°C","Open-Meteo model · "+stamp(current.time),"Current estimate, not a station measurement");
    } else {
      const temp=latestNASA(nasa,"T2M",now);
      metric("temp","Air temperature",temp?temp.value.toFixed(1)+"°C":"N/A",
        temp?"NASA POWER daily mean · "+temp.date:"No temperature data available",
        temp?"Dated daily fallback; not current weather":"Check the source connection");
    }
    if(numeric(current?.humidity)) {
      metric("humidity","Relative humidity",current.humidity.toFixed(0)+"%","Open-Meteo model · "+stamp(current.time),"Current estimate",current.humidity);
    } else {
      const rh=latestNASA(nasa,"RH2M",now);
      metric("humidity","Relative humidity",rh?rh.value.toFixed(1)+"%":"N/A",
        rh?"NASA POWER daily mean · "+rh.date:"No humidity data available","Dated fallback; not current weather",rh?.value);
    }
    const heat=heatIndexC(current?.temperature,current?.humidity);
    metric("heatStress","Heat index · derived",numeric(heat)?heat.toFixed(1)+"°C":"N/A",
      numeric(heat)?"NWS equation from temperature + humidity · "+stamp(current.time):"Concurrent current temperature and humidity required",
      "Human shaded-heat indicator; not a crop-stress measurement");
    if(rain) {
      metric("rainfall","Rainfall · previous 24h",rain.value.toFixed(2)+" mm","Open-Meteo model · ending "+stamp(rain.end),"24 complete hourly values; not a forecast total");
    } else metric("rainfall","Rainfall · daily fallback",rainNASA?rainNASA.value.toFixed(2)+" mm":"N/A",
      rainNASA?"NASA "+(nasa?.properties?.parameter?.IMERG_PRECTOT?.[rainNASA.date.replace(/-/g,"")]===rainNASA.value?"IMERG":"POWER corrected")+" · "+rainNASA.date:"Incomplete rainfall coverage; no total calculated",
      "A dated UTC day is not the preceding 24 hours");
    if(et) metric("evapotranspiration","Evapotranspiration · NASA",et.value.toFixed(2)+" mm",
      "NASA POWER · "+et.date+" UTC day; "+et.energy.toFixed(2)+" MJ/m²/day ÷ 2.45",
      "Approximate modelled water-depth equivalent; not field-measured ET");
    else metric("evapotranspiration","Reference evapotranspiration",referenceET?referenceET.value.toFixed(2)+" mm":"N/A",
      referenceET?"Open-Meteo FAO-56 ET₀ · 24h ending "+stamp(referenceET.end):"No complete evapotranspiration data",
      "Weather-model reference grass ET₀; not actual crop water use");
    if(nasaMoisture) metric("moisture","Soil moisture", (100*nasaMoisture.value).toFixed(1)+"% vol",
      "NASA POWER "+(nasaMoisture===root?"root zone 0–100 cm":"surface 0–5 cm")+" · "+nasaMoisture.date,
      "Volumetric water content; not percent saturation",100*nasaMoisture.value);
    else if(soil) metric("moisture","Surface soil moisture",(100*soil.value).toFixed(1)+"% vol",
      "Open-Meteo model · 0–1 cm · "+stamp(soil.time),
      "Model fallback; NASA volumetric/SMAP data unavailable",100*soil.value);
    else metric("moisture","Soil wetness · NASA index",wetness?wetness.value.toFixed(2):"N/A",
      wetness?"NASA POWER root-zone wetness · "+wetness.date:"No valid soil-moisture data",
      "0–1 wetness index; not volumetric soil moisture",wetness?100*wetness.value:null);
    const validTerrain=numeric(terrain?.slopeDegrees)&&terrain.slopeDegrees>=0&&terrain.slopeDegrees<=90;
    metric("erosion","Erosion screen · terrain",validTerrain?terrain.slopeDegrees.toFixed(1)+"° slope":"N/A",
      validTerrain?"NASA/USGS SRTM ≈90 m · "+terrain.slopePercent.toFixed(1)+"% gradient; "+terrain.elevationMeters.toFixed(0)+" m elevation":"Terrain service unavailable; restart node serve.cjs if needed",
      "Terrain proxy only; no erosion probability or soil-loss estimate");
    const status=document.querySelector(".section-heading p");
    if(status)status.textContent=point.name+" · "+point.latitude.toFixed(4)+", "+point.longitude.toFixed(4)+" · sources have different dates";
    const banner=byId("alert-banner"),text=byId("alert-text");
    const staleCurrent=current && now-current.time>hour;
    if(Object.keys(payload.errors||{}).length||Object.values(sources).some(source=>source.stale)||staleCurrent) {
      if(text)text.textContent="Some readings are delayed, unavailable or cached. Check the source and date on each card.";
      banner?.classList.remove("hidden");
    } else banner?.classList.add("hidden");
  }
  function start() {
    const region=byId("regionSelect");if(!region)return;
    const lat=byId("dashboard-latitude"),lon=byId("dashboard-longitude"),form=byId("dashboard-location");
    const gps=byId("dashboard-gps"),locationStatus=byId("location-status");
    const report=text=>{if(locationStatus)locationStatus.textContent=text;};
    const crop=byId("advisory-crop"),stage=byId("advisory-stage");
    if(advisoryEngine&&crop&&stage) {
      try {
        const saved=JSON.parse(localStorage.getItem("agrosync.advisoryContext"))||{};
        const context=advisoryEngine.validContext(saved.crop,saved.stage);
        crop.value=context.crop;stage.value=context.stage;
      }catch{}
      const updateContext=()=>{
        const context=advisoryEngine.validContext(crop.value,stage.value);
        try{localStorage.setItem("agrosync.advisoryContext",JSON.stringify(context));}catch{}
        renderAdvisories();
      };
      crop.addEventListener("change",updateContext);
      stage.addEventListener("change",updateContext);
    }
    let point,controller,sequence=0,lastLoad=0;
    try {const saved=JSON.parse(localStorage.getItem("agrosync.region"));if(REGIONS[saved])region.value=saved;}catch{}
    function capital() {
      const [name,town,latitude,longitude]=REGIONS[region.value]||REGIONS.ahafo;
      return {name:town+" reference point, "+name,latitude,longitude};
    }
    async function load() {
      lastLoad=Date.now();
      const run=++sequence;controller?.abort();controller=new AbortController();
      const active=controller;
      clear("Loading data for "+point.name+"…");
      latestAdvisoryPayload=null;renderAdvisories();
      rotationPlanner?.update(null,point);
      const status=document.querySelector(".section-heading p");
      if(status)status.textContent="Loading independent weather, NASA and terrain sources…";
      region.setAttribute("aria-busy","true");
      const timeout=setTimeout(()=>active.abort(),40000);
      try {
        if(window.location.protocol==="file:")throw new Error("Run node serve.cjs and open http://127.0.0.1:5500/ to load the dashboard.");
        const query=new URLSearchParams({latitude:point.latitude.toFixed(4),longitude:point.longitude.toFixed(4)});
        const response=await fetch("/api/dashboard?"+query,{signal:active.signal,cache:"no-store"});
        if(response.status===404)throw new Error(["localhost","127.0.0.1","[::1]"].includes(window.location.hostname||"localhost") ?
          "Restart the app with node serve.cjs. A static-only server cannot load the dashboard data API." :
          "The online weather service has not been deployed. Please contact the AgroSync administrator.");
        if(response.headers?.get("content-type")?.includes("text/html"))throw new Error("The weather service is not configured for this website. Please contact the AgroSync administrator.");
        const data=await response.json();
        if(run!==sequence)return;
        if(!data.sources)throw new Error(data.error||"The dashboard data service returned an invalid response.");
        if(!Object.keys(data.sources).length)throw new Error(Object.values(data.errors||{}).join(" ")||"All data sources are unavailable.");
        if(!numeric(data.coordinates?.latitude)||!numeric(data.coordinates?.longitude)||Math.abs(data.coordinates.latitude-point.latitude)>0.00011||Math.abs(data.coordinates.longitude-point.longitude)>0.00011)throw new Error("Data location does not match the requested point.");
        render(data,point);
      } catch(error) {
        if(run!==sequence)return;
        clear("Data not loaded");
        latestAdvisoryPayload=null;renderAdvisories();
        setText("alert-text",error.name==="AbortError"?"Data request timed out. Try again shortly.":error.message);
        byId("alert-banner")?.classList.remove("hidden");
        if(status)status.textContent=point.name+" · Data unavailable";
      } finally {clearTimeout(timeout);if(run===sequence)region.removeAttribute("aria-busy");}
    }
    function choose(next) {
      point=next;
      if(lat)lat.value=point.latitude.toFixed(4);if(lon)lon.value=point.longitude.toFixed(4);
      report("Selected "+point.name+". Readings describe this point, not all of Ghana.");
      load();
    }
    region.addEventListener("change",()=>{
      try{localStorage.setItem("agrosync.region",JSON.stringify(region.value));}catch{}
      choose(capital());
    });
    form?.addEventListener("submit",event=>{
      event.preventDefault();if(!form.reportValidity())return;
      const latitude=lat.value.trim()?Number(lat.value):NaN,longitude=lon.value.trim()?Number(lon.value):NaN;
      if(!validCoordinates(latitude,longitude)){report("Enter valid coordinates in Ghana's bounding area.");return;}
      choose({name:"Custom farm/locality point",latitude,longitude});
    });
    gps?.addEventListener("click",()=>{
      if(!navigator.geolocation){report("This browser cannot access GPS. Enter the farm coordinates instead.");return;}
      gps.disabled=true;report("Requesting your location…");
      navigator.geolocation.getCurrentPosition(position=>{
        gps.disabled=false;
        const latitude=position.coords.latitude,longitude=position.coords.longitude;
        if(!validCoordinates(latitude,longitude)){report("Your location is outside Ghana's bounding area. Select a Ghana reference point or enter coordinates.");return;}
        choose({name:"Your GPS location",latitude,longitude});
        report("GPS location selected; device accuracy approximately ±"+Math.round(position.coords.accuracy)+" m. Dataset grid resolution is coarser.");
      },()=>{gps.disabled=false;report("Location permission was denied or GPS is unavailable. Enter coordinates instead.");},
      {enableHighAccuracy:true,timeout:15000,maximumAge:60000});
    });
    const refresh=()=>{if(!document.hidden&&Date.now()-lastLoad>10*60000)load();};
    const timer=setInterval(refresh,10*60000);
    window.addEventListener("focus",refresh);window.addEventListener("online",refresh);
    document.addEventListener("visibilitychange",refresh);
    window.addEventListener("pagehide",()=>{controller?.abort();clearInterval(timer);},{once:true});
    window.addEventListener("pageshow",event=>{if(event.persisted)window.location.reload();});
    choose(capital());
  }
  return {REGIONS,validCoordinates,latestNASA,rolling24Hours,currentWeather,modelSoil,nasaET,heatIndexC,render,start};
})();
if(typeof document!=="undefined") {
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",AgroDashboard.start,{once:true});
  else AgroDashboard.start();
}
if(typeof module!=="undefined"&&module.exports)module.exports=AgroDashboard;

