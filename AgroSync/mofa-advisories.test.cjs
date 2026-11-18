"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto");
const engine=require("./mofa-advisories.js");
const NOW=Date.UTC(2026,10,15,12),DAY=86400000;
const rain=value=>({value,start:NOW-DAY,end:NOW});
const daily=(value,date="2026-11-14",unit="mm/day")=>({value,date,unit});
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,"mofa-source-catalog.json"),"utf8"));
const get=(crop,stage="vegetative",overrides={})=>engine.generate({crop,stage,rain24:rain(0),now:NOW,...overrides});
const summaries=new Set();
const cited=new Set();
for(const crop of Object.keys(engine.CROPS))for(const stage of Object.keys(engine.STAGES)) {
 for(const overrides of [{rain24:rain(0)},{rain24:rain(12)},{rain24:null},{weatherStale:true},
   {rain24:{...rain(0),start:NOW-23*3600000}},
   {rain24:{value:0,start:NOW+3600000-DAY,end:NOW+3600000}},
   {rain24:{value:0,start:NOW-2*3600000-DAY,end:NOW-2*3600000}},
   {referenceET24:rain(6)},
   {rain24:rain(2),referenceET24:rain(6),terrainGradient:8},
   {rain24:null,nasaDaily:{modelRain:daily(1),evapotranspiration:daily(4)},terrainGradient:8},
   {rain24:null,nasaDaily:{satelliteRain:daily(12)},terrainGradient:8}]) {
  const recommendations=get(crop,stage,overrides);
  assert.equal(recommendations.length,1,"Exactly one recommendation for "+crop+"/"+stage);
  const item=recommendations[0],words=item.text.trim().split(/\s+/).length;
  assert.ok(words>=20&&words<=150,"Word limit: "+crop+"/"+stage+" ("+words+")");
  assert.ok([...item.text].length<=1600,"Recommendation fits the broadcast message limit");
  assert.equal(item.crop,crop);assert.equal(item.stage,stage);summaries.add(item.text);
  for(const source of item.sources) {
   assert.ok(engine.SOURCES[source.id]);assert.ok(!source.href.includes("undefined"));
   const url=new URL(source.href);
   assert.equal(url.protocol,"https:");
   assert.ok(["www.mofa.gov.gh","mofa.gov.gh","srid.mofa.gov.gh","www.fao.org"].includes(url.hostname),source.href);
   assert.ok(!["unverified-working-note","policy-research-excluded","duplicate","historical-context-superseded"].includes(source.status));
   const entry=[...catalog.sources,...catalog.externalSources].find(s=>s.id===source.id);
   assert.ok(entry,"Source is catalogued: "+source.id);
   assert.ok(source.page>=1&&source.page<=entry.pages);
   assert.ok(entry.reviewedPdfPages.includes(source.page),"Cited page was reviewed: "+source.id+"/"+source.page);
   assert.ok(source.href.endsWith("#page="+source.page));
   cited.add(source.id);
  }
 }
}
assert.ok(summaries.size>40,"Advice must vary with crop, stage and weather");
for(const entry of catalog.sources) {
 const actual=crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname,"MoFA",entry.file))).digest("hex");
 assert.equal(actual,entry.sha256,"Source changed since review: "+entry.file);
 if(entry.duplicateOf)assert.equal(entry.sha256,catalog.sources.find(s=>s.id===entry.duplicateOf).sha256);
}
assert.deepEqual(catalog.sources.map(s=>s.file).sort(),fs.readdirSync(path.join(__dirname,"MoFA")).filter(f=>/\.(pdf|mht)$/i.test(f)).sort());
assert.equal(catalog.sources.length,15);
assert.equal(new Set(catalog.sources.map(s=>s.sha256)).size,13);
for(const id of ["facts2021","facts2024","conservation"])assert.ok(cited.has(id),"New applicable source is used: "+id);
assert.ok(!cited.has("funding2016")&&!cited.has("facts2015"));
console.log("PASS: one 20-150-word card across crop/stage/weather combinations; reviewed official MoFA/FAO pages; all 15 source files unchanged and duplicates excluded");
assert.deepEqual(engine.validContext("<script>","bogus"),{crop:"general",stage:"unspecified"});
assert.match(get("general")[0].text,/Choose a crop/);
assert.match(get("maize","unspecified")[0].text,/Select the actual growth stage/);
assert.match(get("maize","flowering")[0].text,/tasselling and silking/);
assert.doesNotMatch(get("maize","vegetative")[0].text,/tasselling and silking/);
assert.match(get("pepper","flowering")[0].text,/pepper flowering/);
assert.match(get("cabbage","fruiting")[0].text,/head formation/);
assert.match(get("cabbage","mature")[0].text,/Reduce watering/);
assert.doesNotMatch(get("cabbage","nursery")[0].text,/Reduce watering/);
assert.match(get("tomato","planning")[0].text,/crop-family history/);
assert.doesNotMatch(get("tomato","fruiting")[0].text,/crop-family history/);
for(const crop of ["tomato","pepper","cabbage"])assert.match(get(crop,"transplanting")[0].text,/early morning/);
for(const crop of ["cassava","plantain","cocoa"]) {
 assert.match(get(crop,"flowering")[0].text,/general soil-care guidance/);
 assert.ok(get(crop,"flowering")[0].sources.every(s=>s.id==="soil"));
}
assert.match(get("maize","mature",{rain24:rain(8)})[0].text,/drying grain protected/);
assert.doesNotMatch(get("maize","mature")[0].text,/supplementary irrigation/);
assert.match(get("maize")[0].text,/No rain is estimated/);
assert.match(get("maize","vegetative",{rain24:rain(12)})[0].text,/standing water/);
for(const overrides of [{rain24:null},{weatherStale:true},
 {rain24:{...rain(0),start:NOW-23*3600000}},
 {rain24:{value:0,start:NOW+3600000-DAY,end:NOW+3600000}},
 {rain24:{value:0,start:NOW-2*3600000-DAY,end:NOW-2*3600000}}]) {
 const item=get("maize","vegetative",overrides)[0];
 assert.match(item.text,/Fresh weather readings are unavailable/);
 assert.doesNotMatch(item.text,/No rain is estimated|Rain is estimated/);
}
assert.doesNotMatch(get("maize")[0].text,/ET|NASA|SRTM|nitrogen|phosphorus|modelled/);
console.log("PASS: correct crop/stage actions, transparent general-care fallback, harvest-specific advice and no weather claims from partial/future/stale data");

const rule=(item,id)=>item.appliedRules.includes(id);
const matched=get("maize","flowering",{referenceET24:rain(6)})[0];
assert.ok(rule(matched,"reference-et"));
assert.match(matched.text,/same 24 hours/);
for(const referenceET24 of [null,rain(-1),rain(NaN),rain(Infinity),rain(0),
 {...rain(6),start:NOW-DAY+3600000},{...rain(6),start:NOW-DAY-3600000,end:NOW-3600000}]) {
 assert.ok(!rule(get("maize","flowering",{referenceET24})[0],"reference-et"));
}
assert.ok(!rule(get("maize","flowering",{referenceET24:rain(6),weatherStale:true})[0],"reference-et"));
const nasa={modelRain:daily(1),evapotranspiration:daily(4)};
const fromNASA=get("pepper","flowering",{rain24:null,nasaDaily:nasa})[0];
assert.ok(rule(fromNASA,"nasa-et"));
assert.match(fromNASA.text,/NASA's daily estimate for 2026-11-14/);
assert.doesNotMatch(fromNASA.text,/past day|same 24 hours/);
for(const evapotranspiration of [daily(4,"2026-11-13"),daily(4,"2026-11-15"),daily(4,"2026-11-11"),daily(4,"2026-02-30"),daily(4,"2026-11-14","MJ/m^2/day"),daily(-999),daily(Infinity)]) {
 assert.ok(!rule(get("pepper","flowering",{rain24:null,nasaDaily:{...nasa,evapotranspiration}})[0],"nasa-et"));
}
assert.ok(!rule(get("pepper","flowering",{rain24:null,nasaDaily:nasa,nasaStale:true})[0],"nasa-et"));
const satellite=get("pepper","flowering",{rain24:null,nasaDaily:{...nasa,satelliteRain:daily(12)}})[0];
assert.equal(satellite.evidence.rain.value,12);
assert.ok(!rule(satellite,"nasa-et"),"Conflicting satellite/model rain must not support a water-loss comparison");
const newerModel=get("pepper","flowering",{rain24:null,nasaDaily:{...nasa,satelliteRain:daily(12,"2026-11-13")}})[0];
assert.equal(newerModel.evidence.rainDate,"2026-11-14");
assert.ok(rule(newerModel,"nasa-et"));
const preferredCurrent=get("pepper","flowering",{rain24:rain(0),nasaDaily:nasa})[0];
assert.match(preferredCurrent.text,/No rain is estimated for the past day/);
assert.doesNotMatch(preferredCurrent.text,/NASA/);
assert.ok(!rule(preferredCurrent,"nasa-et"));
for(const row of [daily(-999),daily(12,"2026-11-15"),daily(12,"2026-11-11"),daily(12,"2026-11-14","cm"),daily(12,"invalid")]) {
 assert.match(get("pepper","flowering",{rain24:null,nasaDaily:{satelliteRain:row}})[0].text,/Fresh weather readings are unavailable/);
}
const runoff=get("tomato","vegetative",{rain24:rain(12),terrainGradient:8})[0];
assert.ok(rule(runoff,"runoff-field-check"));
assert.ok(rule(runoff,"soil-drainage-priority"));
assert.match(runoff.text,/valley bottoms/);
assert.doesNotMatch(runoff.text,/flood warning|erosion risk is|erosion detected/i);
for(const overrides of [{terrainStale:true},{terrainGradient:0},{terrainGradient:-1},{terrainGradient:Infinity},{terrainGradient:null},{weatherStale:true}]) {
 assert.ok(!rule(get("tomato","vegetative",{rain24:rain(12),terrainGradient:8,...overrides})[0],"runoff-field-check"));
}
const planning=get("maize","planning")[0];
assert.ok(rule(planning,"ghana-seasonal-planning"));
assert.ok(rule(planning,"cover-rotation-planning"));
assert.match(planning.text,/locally adapted cover crop/);
assert.doesNotMatch(planning.text,/Paraguay|August|September|mucuna|yield increase/i);
assert.ok(!rule(get("maize","mature",{referenceET24:rain(6)})[0],"reference-et"));
assert.ok(!rule(get("maize","mature",{rain24:null,nasaDaily:nasa})[0],"nasa-et"));
console.log("PASS: date/unit-safe NASA fallback, matching rainfall/ET periods, terrain and valley-soil checks, local rotation planning and mature-maize protection");

class Element {
 constructor(){this.textContent="";this.value="";this.style={};this.attrs={};this.events={};this.children=[];this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x)};}
 setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}
 addEventListener(k,fn){this.events[k]=fn;}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}
 closest(){return {querySelector:()=>this.heading ||=new Element()};}
}
const nodes=new Map(),html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");
for(const m of html.matchAll(/id="([^"]+)"/g))nodes.set(m[1],new Element());
nodes.get("regionSelect").value="ahafo";
nodes.get("advisory-crop").value="general";nodes.get("advisory-stage").value="unspecified";
nodes.get("dashboard-location").reportValidity=()=>true;
let requests=0;
const weather={hourly:{time:[],precipitation:[],et0_fao_evapotranspiration:[]},
 hourly_units:{precipitation:"mm",et0_fao_evapotranspiration:"mm"}};
for(let i=0;i<24;i++) {
 weather.hourly.time.push(new Date(NOW-(23-i)*3600000).toISOString().slice(0,16));
 weather.hourly.precipitation.push(0);weather.hourly.et0_fao_evapotranspiration.push(0.1);
}
class Clock extends Date {static now(){return NOW;}}
const document={readyState:"loading",hidden:false,events:{},getElementById:id=>nodes.get(id)||null,
 querySelector:()=>new Element(),createElement:()=>new Element(),addEventListener(k,fn){this.events[k]=fn;}};
const store=new Map();
const context=vm.createContext({document,Date:Clock,URLSearchParams,AbortController,console,navigator:{},setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},
 window:{location:{protocol:"http:"},addEventListener(){}},
 localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
 fetch:async()=>{requests++;return {status:200,json:async()=>({coordinates:{latitude:6.803,longitude:-2.517},
 sources:{weather:{data:weather}},errors:{}})}}
});
const testContainer=new Element();
const previousDocument=global.document;global.document=document;
try {
 for(const crop of Object.keys(engine.CROPS))for(const stage of Object.keys(engine.STAGES)) {
  engine.render(testContainer,get(crop,stage));
  assert.equal(testContainer.children.length,1);
  const block=testContainer.children[0];
  assert.equal(block.children.length,2,"Only the heading and recommendation are displayed; internal citations are not rendered");
  const words=block.children[1].textContent.trim().split(/\s+/).length;
  assert.ok(words>=20&&words<=150);
 }
} finally {global.document=previousDocument;}
vm.runInContext(fs.readFileSync(path.join(__dirname,"mofa-advisories.js"),"utf8"),context);
vm.runInContext(fs.readFileSync(path.join(__dirname,"script.js"),"utf8"),context);
(async()=>{
 document.events.DOMContentLoaded();
 await new Promise(resolve=>setTimeout(resolve,10));
 const flatten=node=>[node.textContent,...node.children.flatMap(child=>flatten(child))].join(" ");
 assert.match(flatten(nodes.get("recommendations-container")),/Select a crop/);
 nodes.get("advisory-crop").value="maize";nodes.get("advisory-stage").value="flowering";
 nodes.get("advisory-crop").events.change();
 assert.match(flatten(nodes.get("recommendations-container")),/tasselling and silking/);
 assert.doesNotMatch(flatten(nodes.get("recommendations-container")),/PDF page|Source:|MoFA Maize Production Guide/);
 let broadcastDraft=JSON.parse(store.get("agrosync.recommendationDraft"));
 assert.equal(broadcastDraft.text,nodes.get("recommendations-container").children[0].children[1].textContent);
 assert.match(broadcastDraft.title,/Maize/);
 assert.match(broadcastDraft.location,/Goaso/);
 assert.equal(broadcastDraft.generatedAt,NOW);
 assert.equal(broadcastDraft.version,1);
 assert.equal(nodes.get("recommendations-container").children.length,1);
 assert.equal(requests,1,"Crop selection should reuse loaded weather rather than refetching");
 nodes.get("advisory-crop").value="tomato";nodes.get("advisory-stage").value="planning";nodes.get("advisory-stage").events.change();
 assert.match(flatten(nodes.get("recommendations-container")),/crop-family history/);
 assert.ok(!flatten(nodes.get("recommendations-container")).includes("tasselling and silking"));
 assert.equal(JSON.parse(store.get("agrosync.advisoryContext")).crop,"tomato");
 assert.ok(!nodes.has("alerts-container"),"No separate technical-card container");
 assert.equal(nodes.get("recommendations-container").children.length,1);
 const point={name:"Accra test point",latitude:5.6037,longitude:-0.187};
 nodes.get("advisory-crop").value="pepper";nodes.get("advisory-stage").value="flowering";
 context.testPoint=point;
 context.testNASA={properties:{parameter:{PRECTOTCORR:{"20261114":1},EVPTRNS:{"20261114":9.8}}},
  parameters:{PRECTOTCORR:{units:"mm/day"},EVPTRNS:{units:"MJ/m^2/day"}}};
 vm.runInContext("AgroDashboard.render({sources:{nasa:{data:testNASA},terrain:{data:{slopePercent:8,slopeDegrees:4.57,elevationMeters:50}}}},testPoint,Date.now())",context);
 const nasaText=flatten(nodes.get("recommendations-container"));
 assert.match(nasaText,/NASA's daily estimate for 2026-11-14/);
 assert.match(nasaText,/water loss exceeded rainfall/);
 assert.match(nasaText,/sloping parts/);
 assert.match(nasaText,/valley bottoms/);
 assert.doesNotMatch(nasaText,/FAO conservation guide|MoFA Facts & Figures 2021|PDF page|Source:/);
 assert.equal(nodes.get("recommendations-container").children.length,1);
 vm.runInContext("AgroDashboard.render({sources:{nasa:{data:testNASA,stale:true}}},testPoint,Date.now())",context);
 assert.match(flatten(nodes.get("recommendations-container")),/Fresh weather readings are unavailable/);
 assert.doesNotMatch(flatten(nodes.get("recommendations-container")),/water loss exceeded rainfall/);
 context.testWeather=weather;
 vm.runInContext("AgroDashboard.render({sources:{weather:{data:testWeather},nasa:{data:testNASA}}},testPoint,Date.now())",context);
 assert.match(flatten(nodes.get("recommendations-container")),/same 24 hours/);
 assert.doesNotMatch(flatten(nodes.get("recommendations-container")),/NASA's daily estimate/);
 broadcastDraft=JSON.parse(store.get("agrosync.recommendationDraft"));
 assert.match(broadcastDraft.title,/Pepper/);
 assert.match(broadcastDraft.location,/Accra test point/);
 assert.match(broadcastDraft.text,/same 24 hours/);
 nodes.get("advisory-crop").value="general";nodes.get("advisory-crop").events.change();
 assert.ok(!store.has("agrosync.recommendationDraft"),"Selection prompts must never become broadcast drafts");
 nodes.get("advisory-crop").value="pepper";nodes.get("advisory-stage").value="unspecified";
 nodes.get("advisory-stage").events.change();
 assert.ok(!store.has("agrosync.recommendationDraft"),"An actual stage is required for automatic broadcast text");
 assert.ok(html.indexOf('src="mofa-advisories.js"')<html.indexOf('src="script.js"'));
 assert.ok(!fs.readFileSync(path.join(__dirname,"mofa-advisories.js"),"utf8").includes("innerHTML"));
 assert.match(fs.readFileSync(path.join(__dirname,"serve.cjs"),"utf8"),/".pdf": "application\/pdf"/);
 console.log("PASS: browser integration, instant crop/stage switching, hidden source citations, context persistence and PDF serving");
 console.log("All recommendation tests passed.");
})().catch(error=>{console.error(error);process.exitCode=1;});

