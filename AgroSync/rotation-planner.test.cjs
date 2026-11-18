"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const planner=require("./rotation-planner.js");
const NOW=Date.UTC(2026,10,15,12),DAY=86400000,POINT={name:"Goaso reference point, Ahafo",latitude:6.803,longitude:-2.517};
function fixture(){
 const values={T2M:{},PRECTOTCORR:{},IMERG_PRECTOT:{},EVPTRNS:{},RZMC:{}};
 for(let i=0;i<28;i++){
  const key=new Date(Date.UTC(2026,10,14)-(27-i)*DAY).toISOString().slice(0,10).replace(/-/g,"");
  values.T2M[key]=i<21?28:29;values.PRECTOTCORR[key]=i<21?2:1;values.IMERG_PRECTOT[key]=values.PRECTOTCORR[key];
  values.EVPTRNS[key]=9.8;values.RZMC[key]=i<21?0.35:0.25;
 }
 return {sources:{nasa:{data:{header:{fill_value:-999,time_standard:"UTC"},properties:{parameter:values},parameters:{
  T2M:{units:"C"},PRECTOTCORR:{units:"mm/day"},IMERG_PRECTOT:{units:"mm/day"},EVPTRNS:{units:"MJ/m^2/day"},RZMC:{units:"m3 m-3"}}}},
  terrain:{data:{slopePercent:4,slopeDegrees:2.3,elevationMeters:250}}}};
}
const values={current:"maize",next:"maize",priority:"nitrogen",soil:"sandy",water:"limited",cover:"bare",harvest:"2026-11-20",sowing:"2027-02-01"};
const compare=(input=values,payload=fixture())=>planner.compare(input,payload,POINT,NOW);
const result=compare();
assert.equal(result.strategies.length,3);assert.deepEqual(result.strategies[0].sequence,["Maize","Maize"]);
assert.equal(result.strategies[1].sequence[1],"Cowpea");assert.ok(!result.strategies[1].sequence.includes("Maize, Maize"));
assert.equal(result.strategies[2].sequence[1],"Managed cover phase");assert.equal(result.kind,"annual");
assert.equal(result.evidence.rain.recent,7);assert.equal(result.evidence.rain.earlier,14);
assert.equal(result.evidence.water.rainfall,7);assert.ok(Math.abs(result.evidence.water.waterLoss-28)<1e-10);
assert.equal(result.evidence.flags.waterCheck,true);assert.equal(result.evidence.flags.rootDrying,true);
assert.equal(result.evidence.soil.recent,25);assert.ok(Math.abs(result.evidence.soil.earlier-35)<1e-10);
assert.equal(result.evidence.temperature.recent,29);assert.equal(result.evidence.flags.sloping,true);
assert.ok(result.gap.known&&result.gap.days>0);assert.match(result.gap.text,/report bare soil/);
for(const current of Object.keys(planner.CROPS))for(const next of Object.keys(planner.CROPS))for(const priority of Object.keys(planner.PRIORITIES)){
 const item=compare({...values,current,next,priority});assert.equal(item.strategies.length,3,current+"/"+next);
 assert.equal(new Set(item.strategies.map(s=>s.id)).size,3);
 assert.deepEqual(item.strategies[0].sequence,[planner.CROPS[current].name,planner.CROPS[next].name]);
 if(item.kind==="annual")assert.equal(new Set(item.strategies.map(s=>s.sequence.join("|"))).size,3,"Strategies differ from the entered baseline");
 else assert.match(item.notice,/not validated annual rotations/);
 for(const strategy of item.strategies){
  for(const key of ["why","water"])assert.ok(strategy[key].length>20);
  for(const key of ["benefits","risks","gaps","sources"])assert.ok(strategy[key].length);
  for(const source of strategy.sources){
   const entry=planner.SOURCES[source.id];assert.ok(entry);const url=new URL(source.href);assert.equal(url.protocol,"https:");
   assert.ok(["www.mofa.gov.gh","mofa.gov.gh","www.fao.org"].includes(url.hostname));
   if(source.page){assert.ok(entry.pages.includes(source.page));assert.ok(source.href.endsWith("#page="+source.page));}
  }
 }
 assert.ok(!("score" in item)&&item.strategies.every(s=>!("predictedYield" in s)),"Do not invent suitability scores or yield predictions");
 const suggestion=planner.suggest(item),words=suggestion.text.trim().split(/\s+/).length;
 assert.ok(words>=20&&words<=150,"One concise suggestion: "+current+"/"+next+"/"+priority+" ("+words+")");
 assert.match(suggestion.text,/MoFA extension officer before changing your rotation\.$/);
 assert.ok(item.strategies.some(s=>s.id===suggestion.strategyId));assert.ok(suggestion.sources.length);
}
assert.equal(compare({}).strategies.length,0);assert.equal(compare({current:"<script>",next:"maize"}).strategies.length,0);
assert.equal(planner.suggest(compare({})).strategyId,null);
assert.match(planner.suggest(compare({...values,current:"maize",next:"cocoa"})).text,/Before establishing your planned cocoa/);
assert.doesNotMatch(planner.suggest(compare({...values,current:"maize",next:"cocoa"})).text,/Keep established cocoa/);
assert.equal(planner.suggest(compare({...values,current:"maize",next:"cowpea",priority:"nitrogen"})).strategyId,"existing");
assert.equal(planner.suggest(compare({...values,current:"tomato",next:"maize",priority:"water"})).strategyId,"cover-phase");
assert.match(planner.suggest(compare({...values,water:"limited"},null)).text,/reported limited water/);
assert.doesNotMatch(planner.suggest(compare({...values,water:"limited"},null)).text,/Recent NASA estimates/);
assert.match(compare({...values,current:"groundnut",next:"groundnut"}).strategies[0].risks.join(" "),/rotating groundnut with cereals/);
assert.match(compare({...values,current:"tomato",next:"pepper"}).strategies[0].risks.join(" "),/same family/);
assert.match(compare({...values,current:"cocoa",next:"maize"}).notice,/Do not remove/);
assert.match(compare({...values,priority:"market"}).strategies[1].gaps.join(" "),/net returns are unverified/);
assert.match(compare({...values,priority:"forage"}).strategies[2].gaps.join(" "),/residue can be removed/);
assert.match(compare({...values,priority:"erosion"}).strategies[2].why,/erosion priority/);
assert.match(compare({...values,priority:"organic"}).strategies[2].why,/organic-matter priority/);
console.log("PASS: 726 crop/plan/priority combinations, exact farmer baseline plus two alternatives, evidence sources, benefits, risks, gaps and perennial safeguards");

const missing=compare(values,null);assert.equal(missing.evidence.items.length,0);assert.ok(missing.gaps.some(g=>g.includes("Missing days")));
assert.equal(missing.evidence.flags.waterCheck,undefined);
for(const issue of ["missing","negative","wrong-unit","future","stale","wrong-time-standard"]){
 const p=fixture(),raw=p.sources.nasa.data,key=Object.keys(raw.properties.parameter.PRECTOTCORR).sort().at(-3);
 if(issue==="missing"){delete raw.properties.parameter.PRECTOTCORR[key];delete raw.properties.parameter.IMERG_PRECTOT[key];}
 if(issue==="negative"){raw.properties.parameter.PRECTOTCORR[key]=-999;raw.properties.parameter.IMERG_PRECTOT[key]=-999;}
 if(issue==="wrong-unit"){raw.parameters.PRECTOTCORR.units="cm";raw.parameters.IMERG_PRECTOT.units="cm";}
 if(issue==="future")for(const k of ["PRECTOTCORR","IMERG_PRECTOT"]){raw.properties.parameter[k]={"20261115":100};}
 if(issue==="stale")p.sources.nasa.stale=true;
 if(issue==="wrong-time-standard")raw.header.time_standard="LST";
 assert.equal(compare(values,p).evidence.rain,null,issue);
}
const zero=fixture();for(const key of ["PRECTOTCORR","IMERG_PRECTOT","RZMC"])for(const d of Object.keys(zero.sources.nasa.data.properties.parameter[key]))zero.sources.nasa.data.properties.parameter[key][d]=0;
assert.equal(compare(values,zero).evidence.rain.recent,0);assert.equal(compare(values,zero).evidence.soil.recent,0);
const noOverlap=fixture(),raw=noOverlap.sources.nasa.data;
raw.properties.parameter.EVPTRNS=Object.fromEntries(Array.from({length:7},(_,i)=>[new Date(NOW-(29-i)*DAY).toISOString().slice(0,10).replace(/-/g,""),9.8]));
assert.equal(compare(values,noOverlap).evidence.water,null,"Never compare disjoint rainfall/ET periods");
const conflict=fixture();for(const key of Object.keys(conflict.sources.nasa.data.properties.parameter.IMERG_PRECTOT))conflict.sources.nasa.data.properties.parameter.IMERG_PRECTOT[key]=10;
assert.equal(compare(values,conflict).evidence.flags.waterCheck,false);assert.equal(compare(values,conflict).evidence.water.disagreement,true);
const wrongEnergy=fixture();wrongEnergy.sources.nasa.data.parameters.EVPTRNS.units="W/m2";
assert.equal(compare(values,wrongEnergy).evidence.water,null);
const indexed=fixture();indexed.sources.nasa.data.parameters.RZMC.units="1";assert.equal(compare(values,indexed).evidence.soil,null);
const staleTerrain=fixture();staleTerrain.sources.terrain.stale=true;assert.equal(compare(values,staleTerrain).evidence.terrain,null);
assert.ok(compare({...values,water:"unknown",soil:"unknown"},null).gaps.some(g=>g.includes("Soil texture is not supplied")));
const noGap=planner.calendar(planner.normalize({...values,harvest:"2026-11-20",sowing:"2026-11-20"}),NOW);assert.equal(noGap.days,0);
assert.equal(planner.calendar({...values,sowing:"2026-01-01"},NOW).error,true);
assert.equal(planner.calendar({...values,sowing:"2029-01-01"},NOW).error,true);
assert.equal(planner.calendar({...values,harvest:"2026-02-30"},NOW).known,false);
assert.doesNotMatch(compare({...values,cover:"residues"}).gap.text,/You report bare soil/);
assert.match(compare({...values,cover:"living"}).gap.text,/living cover/);
console.log("PASS: complete matched UTC windows, zero/fill/unit/date checks, stale-source isolation, no index-to-moisture conversion, product disagreement and calendar gaps");

class Element {
 constructor(tag="div"){this.tagName=tag.toUpperCase();this.textContent="";this.value="";this.style={};this.dataset={};this.attrs={};this.events={};this.children=[];this.classList={add(){},remove(){}};}
 setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}
 addEventListener(k,fn){(this.events[k]||=[]).push(fn);}closest(){return {querySelector:()=>new Element("h3")};}reportValidity(){return true;}
 async emit(name,event={}){for(const fn of this.events[name]||[])await fn(event);}
}
const flatten=node=>[node.textContent,...node.children.flatMap(flatten)].join(" ");
(async()=>{
 const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8"),nodes=new Map();
 for(const m of html.matchAll(/id="([^"]+)"/g))nodes.set(m[1],new Element());
 for(const [key,value] of Object.entries(values))nodes.get("rotation-"+key).value=value;
 nodes.get("regionSelect").value="ahafo";nodes.get("advisory-crop").value="general";nodes.get("advisory-stage").value="unspecified";
 const store=new Map(),document={readyState:"loading",hidden:false,events:{},getElementById:id=>nodes.get(id)||null,querySelector:()=>new Element(),createElement:tag=>new Element(tag),addEventListener(k,fn){(this.events[k]||=[]).push(fn);}};
 class Clock extends Date {static now(){return NOW;}}
 let requests=0,resolveNext;
 const payload=fixture();payload.coordinates={latitude:POINT.latitude,longitude:POINT.longitude};
 const context=vm.createContext({document,Date:Clock,URLSearchParams,AbortController,console,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},navigator:{},
  window:{location:{protocol:"http:"},addEventListener(){}},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  fetch:async()=>{requests++;if(requests===1)return {status:200,json:async()=>payload};return new Promise(resolve=>{resolveNext=resolve;});}});
 for(const file of ["mofa-advisories.js","rotation-planner.js","script.js"])vm.runInContext(fs.readFileSync(path.join(__dirname,file),"utf8"),context);
 for(const fn of document.events.DOMContentLoaded)await fn();await new Promise(r=>setTimeout(r,10));
 for(const [key,value] of Object.entries(values))nodes.get("rotation-"+key).value=value;
 nodes.get("rotation-current").value="";nodes.get("rotation-next").value="";
 await nodes.get("rotation-form").emit("input");
 assert.doesNotMatch(flatten(nodes.get("rotation-results")),/Crop rotation suggestion/);
 nodes.get("rotation-current").value=values.current;await nodes.get("rotation-form").emit("input");
 assert.doesNotMatch(flatten(nodes.get("rotation-results")),/Crop rotation suggestion/,"Wait for both required crop selections");
 nodes.get("rotation-next").value=values.next;await nodes.get("rotation-form").emit("input");
 const rotationFormMarkup=html.match(/<form id="rotation-form"[\s\S]*?<\/form>/)[0];
 assert.doesNotMatch(rotationFormMarkup,/<button\b|Get rotation suggestion|Compare strategies/);
 const descendants=node=>[node,...node.children.flatMap(descendants)];
 let text=flatten(nodes.get("rotation-results"));assert.match(text,/Crop rotation suggestion/);assert.match(text,/cowpea/);assert.match(text,/reported limited water/);
 assert.equal(nodes.get("rotation-results").children.length,1);
 assert.equal(nodes.get("rotation-results").children[0].className,"alert alert-info");
 assert.equal(nodes.get("rotation-results").children[0].children.length,2,"Only the heading and suggestion are displayed");
 assert.ok(!descendants(nodes.get("rotation-results")).some(node=>node.tagName==="A"),"Source links are not displayed");
 assert.doesNotMatch(text,/Source:|MoFA maize guide|FAO rotation and cover guide/);
 assert.ok(!descendants(nodes.get("rotation-results")).some(node=>["TABLE","DETAILS","OL"].includes(node.tagName)),"Only one suggestion card, without a comparison table or extra panels");
 const suggestionBody=nodes.get("rotation-results").children[0].children[1].textContent;
 assert.ok(suggestionBody.trim().split(/\s+/).length<=150);
 assert.equal(requests,1,"Planner uses the loaded NASA response, not another weather request");
 nodes.get("rotation-sowing").value="2026-01-01";await nodes.get("rotation-form").emit("input");
 assert.match(flatten(nodes.get("rotation-results")),/Correct the harvest and next-sowing dates/);
 nodes.get("rotation-sowing").value=values.sowing;await nodes.get("rotation-form").emit("input");
 assert.doesNotMatch(flatten(nodes.get("rotation-results")),/Correct the harvest and next-sowing dates/);
 nodes.get("advisory-crop").value="maize";nodes.get("advisory-stage").value="flowering";await nodes.get("advisory-crop").emit("change");
 const broadcastBefore=store.get("agrosync.recommendationDraft");assert.ok(broadcastBefore);
 nodes.get("rotation-current").value="cocoa";await nodes.get("rotation-form").emit("change");
 assert.match(flatten(nodes.get("rotation-results")),/Keep established cocoa in place/);
 assert.equal(store.get("agrosync.recommendationDraft"),broadcastBefore,"Exploratory scenarios never replace the actionable broadcast recommendation");
 assert.equal(nodes.get("recommendations-container").children.length,1);
 assert.equal(JSON.parse(store.get("agrosync.rotationPlan")).current,"cocoa");
 nodes.get("rotation-water").value="unknown";await nodes.get("rotation-form").emit("change");
 assert.match(flatten(nodes.get("rotation-results")),/Recent NASA estimates/);
 nodes.get("regionSelect").value="ashanti";await nodes.get("regionSelect").emit("change");
 text=flatten(nodes.get("rotation-results"));assert.match(text,/Fresh water-condition evidence is unavailable/);assert.doesNotMatch(text,/Recent NASA estimates/);
 resolveNext({status:200,json:async()=>({...payload,coordinates:{latitude:6.6885,longitude:-1.6244}})});await new Promise(r=>setTimeout(r,10));
 assert.match(flatten(nodes.get("rotation-results")),/Recent NASA estimates/);
 assert.ok(html.indexOf('src="rotation-planner.js"')<html.indexOf('src="script.js"'));
 assert.ok(!fs.readFileSync(path.join(__dirname,"rotation-planner.js"),"utf8").includes("innerHTML"));
 console.log("PASS: one 20–150-word suggestion card, no table or extra panels, instant form updates, regional evidence reset and unchanged recommendation/broadcast draft");
 console.log("All rotation planner tests passed.");
})().catch(error=>{console.error(error);process.exitCode=1;});
