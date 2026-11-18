"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const path = require("node:path");
const ui = require("./script.js");
const {createDashboardService,calculateTerrain,terrainPoints,validateCoordinates} = require("./dashboard-data.cjs");
const NOW = Date.UTC(2026,10,15,12,30);
function weatherFixture() {
  const time=[],rain=[],soil=[],et=[];
  for(let i=0;i<72;i++) {
    time.push(new Date(Date.UTC(2026,10,13)+i*3600000).toISOString().slice(0,16));
    rain.push(0.25);soil.push(0.31);et.push(0.1);
  }
  return { current:{time:"2026-11-15T12:30",temperature_2m:30,relative_humidity_2m:70},
    current_units:{temperature_2m:"°C",relative_humidity_2m:"%"},
    hourly:{time,precipitation:rain,soil_moisture_0_to_1cm:soil,et0_fao_evapotranspiration:et},
    hourly_units:{precipitation:"mm",soil_moisture_0_to_1cm:"m³/m³",et0_fao_evapotranspiration:"mm"} };
}
function nasaFixture() {
  return {header:{fill_value:-999,sources:["GEOSIT"]},properties:{parameter:{
    T2M:{"20261112":25.2,"20261113":26.3},RH2M:{"20261113":81},
    EVPTRNS:{"20261112":4.90,"20261113":-999},GWETROOT:{"20261113":0.62},
    SFMC:{"20261113":-999},RZMC:{"20261113":-999},IMERG_PRECTOT:{"20261113":-999},
    PRECTOTCORR:{"20261113":0}
  }},parameters:{EVPTRNS:{units:"MJ/m^2/day"},T2M:{units:"C"},RH2M:{units:"%"},
    RZMC:{units:"m3 m-3"},SFMC:{units:"m3 m-3"},GWETROOT:{units:"1"},PRECTOTCORR:{units:"mm/day"}}};
}
const flatTerrain = () => ({status:"OK",results:Array.from({length:9},()=>({dataset:"srtm90m",elevation:100}))});
function dom() {
  class Element {
    constructor(){this.textContent="";this.value="";this.style={};this.attrs={};this.events={};this.children=[];
      this.classes=new Set();this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c)};}
    setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}
    addEventListener(k,fn){this.events[k]=fn;}
    append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}
    closest(){return {querySelector:()=>this.heading ||=new Element()};}
  }
  const nodes = new Map();
  const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");
  for(const match of html.matchAll(/id="([^"]+)"/g))nodes.set(match[1],new Element());
  const section=new Element(),form=nodes.get("dashboard-location");
  form.reportValidity=()=>true;nodes.get("regionSelect").value="ahafo";
  const document={readyState:"loading",hidden:false,events:{},getElementById:id=>nodes.get(id)||null,
    querySelector:()=>section,createElement:()=>new Element(),addEventListener(k,fn){this.events[k]=fn;}};
  const window={location:{protocol:"http:",reload(){}},events:{},addEventListener(k,fn){this.events[k]=fn;}};
  const storage=new Map();
  const context=vm.createContext({document,window,Date,URLSearchParams,AbortController,console,
    navigator:{},setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},fetch:async()=>{throw Error("offline");}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,"script.js"),"utf8"),context);
  return {context,document,window,nodes,section,run:code=>vm.runInContext(code,context)};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
(async()=>{
  const weather=weatherFixture(),nasa=nasaFixture();
  assert.equal(ui.currentWeather(weather,NOW).temperature,30);
  assert.equal(ui.rolling24Hours(weather,"precipitation",NOW).value,6);
  assert.ok(Math.abs(ui.rolling24Hours(weather,"et0_fao_evapotranspiration",NOW).value-2.4)<1e-9);
  const bad=weatherFixture();bad.hourly.precipitation[bad.hourly.time.indexOf("2026-11-15T10:00")]=null;
  assert.equal(ui.rolling24Hours(bad,"precipitation",NOW),null);
  const future=weatherFixture();future.hourly.precipitation[future.hourly.time.indexOf("2026-11-15T13:00")]=9999;
  assert.equal(ui.rolling24Hours(future,"precipitation",NOW).value,6);
  const zeros=weatherFixture();zeros.hourly.precipitation.fill(0);
  assert.equal(ui.rolling24Hours(zeros,"precipitation",NOW).value,0);
  assert.equal(ui.nasaET(nasa,NOW).value,2);
  assert.equal(ui.nasaET(nasa,NOW).date,"2026-11-12");
  assert.equal(ui.latestNASA(nasa,"T2M",NOW).date,"2026-11-13");
  const missing=nasaFixture();missing.properties.parameter.T2M={"20261340":99,"20260230":99,"20261114":-999};
  assert.equal(ui.latestNASA(missing,"T2M",NOW),null);
  const wrongUnits=nasaFixture();wrongUnits.parameters.EVPTRNS.units="W/m2";
  assert.equal(ui.nasaET(wrongUnits,NOW),null);
  assert.equal(ui.modelSoil(weather,NOW).value,0.31);
  const dry=weatherFixture();dry.hourly.soil_moisture_0_to_1cm.fill(0);
  assert.equal(ui.modelSoil(dry,NOW).value,0);
  assert.ok(Math.abs(ui.heatIndexC((90-32)*5/9,70)-41.1)<0.2);
  assert.equal(ui.heatIndexC(null,70),null);
  assert.equal(ui.heatIndexC(30,101),null);
  assert.equal(Object.keys(ui.REGIONS).length,16);
  console.log("PASS: timestamps, complete preceding-24h totals, no future/missing-value totals, zero values, unit checks, independently dated NASA fields and NWS heat index");

  assert.equal(calculateTerrain(flatTerrain()).slopeDegrees,0);
  const plane=flatTerrain();plane.results.forEach((p,i)=>p.elevation=100+(i%3-1)*9);
  assert.ok(Math.abs(calculateTerrain(plane).slopeDegrees-Math.atan(0.1)*180/Math.PI)<1e-9);
  const voids=flatTerrain();voids.results[0].elevation=null;
  assert.throws(()=>calculateTerrain(voids),/missing/);
  assert.equal(terrainPoints(6.6,-1.6).length,9);
  assert.throws(()=>validateCoordinates(0,0));
  assert.throws(()=>validateCoordinates(NaN,-1));
  console.log("PASS: flat/known-gradient SRTM terrain, missing-elevation rejection and Ghana coordinate validation");

  let clock=NOW,calls=0,weatherDown=false;
  const service=createDashboardService({now:()=>clock,terrainDelay:0,fetchImpl:async url=>{
    calls++;if(url.includes("open-meteo")&&weatherDown)throw Error("weather offline");
    const data=url.includes("open-meteo")?weatherFixture():url.includes("power.larc")?nasaFixture():flatTerrain();
    return {ok:true,json:async()=>data};
  }});
  const [one,two]=await Promise.all([service.get(6.6885,-1.6244),service.get(6.6885,-1.6244)]);
  assert.equal(calls,3);assert.ok(one.sources.weather);assert.ok(two.sources.terrain);
  await service.get(6.6885,-1.6244);assert.equal(calls,3);
  clock+=11*60000;weatherDown=true;
  const cached=await service.get(6.6885,-1.6244);
  assert.equal(cached.sources.weather.stale,true);assert.ok(cached.sources.nasa);
  clock+=2*3600000;
  const partial=await service.get(6.6885,-1.6244);
  assert.ok(partial.errors.weather);assert.ok(!partial.sources.weather);assert.ok(partial.sources.terrain);
  await assert.rejects(service.get(99,0),/Ghana/);
  console.log("PASS: concurrent-request coalescing, source-specific caching, clearly marked stale fallback and independent provider failures");

  const e=dom();
  e.context.fixture={coordinates:{latitude:6.6885,longitude:-1.6244},sources:{
    weather:{data:weather,fetchedAt:NOW},nasa:{data:nasa,fetchedAt:NOW},
    terrain:{data:calculateTerrain(plane),fetchedAt:NOW}},errors:{}};
  e.run("AgroDashboard.render(fixture,{name:'Kumasi reference point',latitude:6.6885,longitude:-1.6244},"+NOW+")");
  for(const id of ["temp","humidity","heatStress","rainfall","evapotranspiration","moisture","erosion"]) {
    assert.notEqual(e.nodes.get(id+"-display").textContent,"N/A",id+" missing");
  }
  assert.equal(e.nodes.get("temp-display").textContent,"30.0°C");
  assert.equal(e.nodes.get("moisture-display").textContent,"31.0% vol");
  assert.equal(e.nodes.get("rainfall-display").textContent,"6.00 mm");
  assert.equal(e.nodes.get("evapotranspiration-display").textContent,"2.00 mm");
  assert.match(e.nodes.get("evapotranspiration-detail").textContent,/2026-11-12/);
  assert.match(e.nodes.get("erosion-display").textContent,/slope/);
  assert.match(e.nodes.get("erosion-trend").textContent,/no erosion probability/);
  assert.match(e.nodes.get("moisture-trend").textContent,/SMAP data unavailable/);
  const noWeather=dom();noWeather.context.fixture={sources:{nasa:{data:nasa},terrain:{data:calculateTerrain(plane)}},errors:{weather:"offline"}};
  noWeather.run("AgroDashboard.render(fixture,{name:'Kumasi reference point',latitude:6.6885,longitude:-1.6244},"+NOW+")");
  assert.equal(noWeather.nodes.get("heatStress-display").textContent,"N/A");
  assert.equal(noWeather.nodes.get("moisture-display").textContent,"0.62");
  assert.match(noWeather.nodes.get("moisture-trend").textContent,/not volumetric/);
  assert.match(noWeather.nodes.get("rainfall-detail").textContent,/2026-11-13/);
  console.log("PASS: all seven cards populated with genuine/derived values, explicit fallback labels, ET conversion and honest erosion proxy");

  const r=dom(),pending=[];
  r.context.fetch=async url=>new Promise(resolve=>pending.push({url,resolve}));
  r.document.events.DOMContentLoaded();
  assert.equal(pending.length,1);
  r.nodes.get("regionSelect").value="ashanti";r.nodes.get("regionSelect").events.change();
  assert.equal(pending.length,2);
  const answer={sources:e.context.fixture.sources,errors:{},coordinates:{latitude:6.6885,longitude:-1.6244}};
  pending[1].resolve({status:200,json:async()=>answer});await tick();
  assert.match(r.section.textContent,/Kumasi/);
  pending[0].resolve({status:200,json:async()=>({...answer,coordinates:{latitude:6.803,longitude:-2.517}})});await tick();
  assert.match(r.section.textContent,/Kumasi/);
  r.nodes.get("dashboard-latitude").value="5.6037";r.nodes.get("dashboard-longitude").value="-0.187";
  r.nodes.get("dashboard-location").events.submit({preventDefault(){}});
  assert.equal(pending.length,3);assert.match(pending[2].url,/latitude=5.6037/);
  pending[2].resolve({status:200,json:async()=>({...answer,coordinates:{latitude:5.6037,longitude:-0.187}})});await tick();
  assert.match(r.section.textContent,/Custom farm/);
  assert.equal(r.nodes.get("regionSelect").attrs["aria-busy"],undefined);
  r.context.fetch=async()=>({status:404});
  r.nodes.get("regionSelect").events.change();await tick();
  assert.match(r.nodes.get("alert-text").textContent,/node serve.cjs/);
  assert.equal(r.nodes.get("temp-display").textContent,"—");
  r.context.window.location.hostname="agrosyncgh.netlify.app";
  r.nodes.get("regionSelect").events.change();await tick();
  assert.match(r.nodes.get("alert-text").textContent,/online weather service/);
  assert.doesNotMatch(r.nodes.get("alert-text").textContent,/node serve.cjs/);
  r.context.fetch=async()=>({status:200,headers:{get:()=>"text/html"}});
  r.nodes.get("regionSelect").events.change();await tick();
  assert.match(r.nodes.get("alert-text").textContent,/not configured for this website/);
  console.log("PASS: automatic startup, region switching, out-of-order response isolation, custom coordinates and actionable static-server error");

  const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");
  const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if(match[1].startsWith("#"))assert.ok(ids.includes(match[1].slice(1)));
    else if(!match[1].startsWith("https:"))assert.ok(fs.existsSync(path.join(__dirname,match[1])));
  }
  assert.match(html,/id="dashboard-gps"/);
  console.log("PASS: dashboard links, GPS controls and unique IDs");
  console.log("All dashboard tests passed.");
})().catch(error=>{console.error(error);process.exitCode=1;});

