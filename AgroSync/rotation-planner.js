/** Reviewed rotation possibilities, not a crop-suitability model or yield forecast. */
"use strict";
const AgroRotationPlanner=(()=>{
 const DAY=86400000,KEY="agrosync.rotationPlan";
 const CROPS=Object.freeze({
  maize:{name:"Maize",family:"cereal"},sorghum:{name:"Sorghum",family:"cereal"},
  cowpea:{name:"Cowpea",family:"legume"},groundnut:{name:"Groundnut",family:"legume"},
  tomato:{name:"Tomato",family:"solanaceous"},pepper:{name:"Pepper",family:"solanaceous"},
  cabbage:{name:"Cabbage",family:"brassica"},cassava:{name:"Cassava",family:"euphorbia"},
  plantain:{name:"Plantain",family:"musa",perennial:true},cocoa:{name:"Cocoa",family:"malvaceae",perennial:true},
  fallow:{name:"Fallow / no crop planned",family:null}
 });
 const PRIORITIES=Object.freeze({water:"Conserve water",organic:"Improve soil cover and organic matter",nitrogen:"Explore nitrogen-fixing crops",
  erosion:"Reduce soil exposure and runoff",forage:"Consider livestock forage",market:"Diversify products for sale"});
 const SOURCES=Object.freeze({
  maize:{title:"MoFA maize guide",url:"https://www.mofa.gov.gh/site/images/pdf/production_guides/GUIDE_TO_MAIZE_PRODUCTION.pdf",pages:[17]},
  tomato:{title:"MoFA tomato guide",url:"https://www.mofa.gov.gh/site/images/pdf/production_guides/TOMATO_Production_Guide.pdf",pages:[6]},
  soil:{title:"MoFA / CSIR soil management",url:"https://mofa.gov.gh/site/images/pdf/production_guides/Manual_on_Soil_Nutrient_Management.pdf",pages:[6,7]},
  conservation:{title:"FAO rotation and cover guide",url:"https://www.fao.org/fileadmin/user_upload/agp/icm12.pdf",pages:[19,20,28,81,82,83]},
  cover:{title:"FAO soil organic cover",url:"https://www.fao.org/conservation-agriculture/in-practice/soil-organic-cover/en",pages:[]},
  groundnut:{title:"MoFA / CSIR-SARI groundnut guidance",url:"https://www.mofa.gov.gh/site/images/pdf/production_guides/Aflatoxin_Contamination_In_Groundnut_And_Maize.pdf",pages:[11]},
  power:{title:"NASA POWER daily data",url:"https://power.larc.nasa.gov/docs/services/api/temporal/daily/",pages:[]},
  methodology:{title:"NASA POWER meteorological sources",url:"https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/",pages:[]},
  terrain:{title:"SRTM via Open Topo Data",url:"https://www.opentopodata.org/datasets/srtm/",pages:[]}
 });
 const numeric=v=>typeof v==="number"&&Number.isFinite(v);
 const iso=time=>new Date(time).toISOString().slice(0,10);
 const oneOf=(value,options,fallback)=>options.includes(value)?value:fallback;
 function date(value){
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const time=Date.parse(value+"T00:00:00Z");
  return Number.isFinite(time)&&iso(time)===value?time:null;
 }
 function normalize(input={}){
  return {
   current:oneOf(input.current,Object.keys(CROPS),""),next:oneOf(input.next,Object.keys(CROPS),""),
   priority:oneOf(input.priority,Object.keys(PRIORITIES),"water"),
   soil:oneOf(input.soil,["unknown","sandy","loamy","clayey"],"unknown"),
   water:oneOf(input.water,["unknown","rainfed","limited","reliable"],"unknown"),
   cover:oneOf(input.cover,["unknown","bare","residues","living"],"unknown"),
   harvest:date(input.harvest)!==null?input.harvest:"",sowing:date(input.sowing)!==null?input.sowing:""
  };
 }
 function calendar(input,now=Date.now()){
  const start=date(input.harvest),end=date(input.sowing);
  if(start===null||end===null)return {known:false,text:"Add harvest and next-sowing dates to explore a possible gap. Dates and cover status come from you; satellite bare-ground detection is not connected."};
  if(end<start||end-start>730*DAY)return {known:false,error:true,text:"Next sowing must be on or after harvest and within two years. Review the entered calendar before planning a cover phase."};
  const days=Math.max(0,(end-start)/DAY-1),past=end<Math.floor(now/DAY)*DAY;
  const status={bare:"You report bare soil in this gap.",residues:"You report residue cover; this is not assumed to be bare soil.",living:"You report living cover; check its water use and termination timing.",unknown:"Cover status is unknown; this is a possible exposure window, not detected bare soil."}[input.cover];
  return {known:true,days,past,harvest:input.harvest,sowing:input.sowing,text:(past?"Past calendar: ":"Your calendar: ")+days+" day(s) between harvest and next sowing. "+status};
 }
 function series(raw,key,units,min,max,now){
  if(raw?.header?.time_standard&&raw.header.time_standard!=="UTC")return [];
  const unit=raw?.parameters?.[key]?.units?.replace(/\s/g,"");
  if(!units.includes(unit))return [];
  const values=raw?.properties?.parameter?.[key];if(!values||typeof values!=="object")return [];
  return Object.entries(values).flatMap(([key,value])=>{
   if(!/^\d{8}$/.test(key))return [];
   const time=date(key.slice(0,4)+"-"+key.slice(4,6)+"-"+key.slice(6));
   if(time===null||time+DAY>now||now-time>40*DAY||!numeric(value)||value===-999||value===raw.header?.fill_value||value<min||value>max)return [];
   return [{time,value}];
  }).sort((a,b)=>a.time-b.time);
 }
 function window(rows,count,now,end=rows.at(-1)?.time){
  if(!numeric(end)||now-end>7*DAY)return null;
  const byTime=new Map(rows.map(row=>[row.time,row.value]));
  const values=Array.from({length:count},(_,i)=>byTime.get(end-(count-1-i)*DAY));
  if(values.some(v=>!numeric(v)))return null;
  return {start:end-(count-1)*DAY,end,values};
 }
 const sum=values=>values.reduce((n,v)=>n+v,0),mean=values=>sum(values)/values.length;
 function contrast(block,scale=1){
  const earlier=block.values.slice(0,7),recent=block.values.slice(7);
  return {...block,earlier:mean(earlier)*scale,recent:mean(recent)*scale};
 }
 function analyze(payload,point,now=Date.now()){
  const evidence={point:point?.name||"Dashboard location not loaded",items:[],gaps:[],flags:{},rain:null,water:null,soil:null,temperature:null,terrain:null};
  const envelope=payload?.sources?.nasa,raw=envelope&&!envelope.stale?envelope.data:null;
  const rainUnits=["mm/day","mmd-1","mm"],modelRows=series(raw,"PRECTOTCORR",rainUnits,0,Infinity,now);
  const imergRows=series(raw,"IMERG_PRECTOT",rainUnits,0,Infinity,now);
  const imerg=window(imergRows,14,now),model=window(modelRows,14,now),rain=imerg||model;
  if(rain){
   const earlier=sum(rain.values.slice(0,7)),recent=sum(rain.values.slice(7));
   evidence.rain={...rain,earlier,recent,source:imerg?"GPM IMERG via NASA POWER":"NASA POWER corrected model rainfall"};
   evidence.flags.rain=recent>0;
   evidence.items.push({id:"rain",text:evidence.rain.source+": "+iso(rain.start)+"–"+iso(rain.end)+" UTC. Latest seven days "+recent.toFixed(1)+" mm; preceding seven days "+earlier.toFixed(1)+" mm.",sources:["power"]});
  }else evidence.gaps.push("No fresh, complete pair of seven-day NASA rainfall windows is available. Missing days are not counted as zero rain.");
  const etRows=series(raw,"EVPTRNS",["MJ/m^2/day","MJ/m2/day"],0,Infinity,now);
  const rainTimes=new Set(modelRows.map(r=>r.time)),end=etRows.filter(r=>rainTimes.has(r.time)).at(-1)?.time;
  const et=numeric(end)?window(etRows,7,now,end):null,matchedRain=numeric(end)?window(modelRows,7,now,end):null;
  if(et&&matchedRain&&et.start===matchedRain.start&&et.end===matchedRain.end){
   const waterLoss=sum(et.values)/2.45,rainfall=sum(matchedRain.values);
   const sameIMERG=window(imergRows,7,now,end),disagreement=!!sameIMERG&&((waterLoss>rainfall)!==(waterLoss>sum(sameIMERG.values)));
   evidence.water={start:et.start,end:et.end,waterLoss,rainfall,disagreement};
   evidence.flags.waterCheck=waterLoss>rainfall&&!disagreement;
   evidence.items.push({id:"water",text:"NASA POWER, "+iso(et.start)+"–"+iso(et.end)+": approximate modeled water loss "+waterLoss.toFixed(1)+" mm versus corrected modeled rain "+rainfall.toFixed(1)+" mm over the same seven days. This is not crop irrigation demand.",sources:["power","methodology"]});
   if(disagreement)evidence.gaps.push("IMERG and corrected model rainfall disagree on the water-loss comparison. That comparison does not trigger a water-shortage interpretation.");
  }else evidence.gaps.push("A matched seven-day NASA rainfall/evaporation window is unavailable; water balance is not inferred from different dates.");
  for(const [key,label] of [["RZMC","root zone (0–100 cm)"],["SFMC","surface (0–5 cm)"]]){
   const block=window(series(raw,key,["m3m-3","m^3/m^3","m³/m³"],0,1,now),14,now);
   if(!block)continue;
   const data=contrast(block,100);evidence.soil={...data,key};
   evidence.flags.rootDrying=key==="RZMC"&&Number(data.recent.toFixed(1))<Number(data.earlier.toFixed(1));
   evidence.items.push({id:"soil",text:"NASA POWER modeled "+label+" moisture, "+iso(block.start)+"–"+iso(block.end)+": latest seven-day mean "+data.recent.toFixed(1)+"% vol; preceding mean "+data.earlier.toFixed(1)+"% vol. These are not plot measurements or percent saturation.",sources:["methodology"]});break;
  }
  if(!evidence.soil)evidence.gaps.push("No complete recent NASA volumetric soil-moisture comparison is available. Wetness indices and shallow weather-model moisture do not establish root-zone drought or soil nutrients.");
  const temp=window(series(raw,"T2M",["C","°C","degC"],-40,60,now),14,now);
  if(temp){
   const data=contrast(temp);evidence.temperature=data;
   evidence.items.push({id:"temperature",text:"NASA POWER daily-mean temperature, "+iso(temp.start)+"–"+iso(temp.end)+": latest seven-day mean "+data.recent.toFixed(1)+"°C; preceding mean "+data.earlier.toFixed(1)+"°C. Daily means do not measure crop heat stress or frost risk.",sources:["methodology"]});
  }else evidence.gaps.push("No complete recent NASA temperature comparison is available.");
  const terrain=payload?.sources?.terrain;
  if(terrain&&!terrain.stale&&numeric(terrain.data?.slopePercent)&&terrain.data.slopePercent>=0&&terrain.data.slopePercent<=1000){
   evidence.terrain=terrain.data.slopePercent;evidence.flags.sloping=evidence.terrain>0;
   evidence.items.push({id:"terrain",text:"NASA/USGS SRTM (2000) terrain screen: "+evidence.terrain.toFixed(1)+"% estimated gradient at roughly 90 m sampling. Check the actual plot; this is not measured erosion or a flood probability.",sources:["terrain"]});
  }else evidence.gaps.push("Fresh usable SRTM terrain evidence is unavailable for this comparison.");
  return evidence;
 }
 const reference=(id,page)=>({id,page:page||null,title:SOURCES[id].title,href:SOURCES[id].url+(page?"#page="+page:"")});
 function compare(values={},payload=null,point=null,now=Date.now()){
  const input=normalize(values),evidence=analyze(payload,point,now),gap=calendar(input,now);
  const result={input,evidence,gap,strategies:[],gaps:[],kind:"annual",priority:PRIORITIES[input.priority]};
  if(!input.current||!input.next){result.prompt="Select the current crop and the next crop in your existing plan. Your actual plan becomes the baseline; it is never guessed from the weather.";return result;}
  const current=CROPS[input.current],next=CROPS[input.next];
  const currentName=current.name,nextName=next.name;
  const sameFamily=!!current.family&&current.family===next.family;
  const dry=input.water==="limited"||evidence.flags.waterCheck||evidence.flags.rootDrying;
  result.gaps=[...evidence.gaps,"Soil pH, nutrient tests, pest history, crop variety/duration and local planting readiness still need field review.",
   "Crop water demand, nitrogen gains, yields, costs and sale prices have not been calculated for these options.",
   "SMAP, ECOSTRESS, Landsat/MODIS vegetation data and GRACE long-term water trends are not connected. Recent POWER data do not establish long-term climate change or forecast next season."];
  if(input.soil==="unknown")result.gaps.push("Soil texture is not supplied; a region-wide soil average is not assigned to your farm.");
  if(input.water==="unknown")result.gaps.push("Water availability is not supplied; irrigation and extra living cover are not assumed feasible.");
  const baseline={id:"existing",title:"Your existing plan",sequence:[currentName,nextName],
   why:"This is the crop sequence you entered. It is the reference for discussion; the app has not measured its costs, yields or soil-health effects.",
   benefits:[input.next==="fallow"?"Keeps your planned fallow; its cover, purpose and duration still need review.":"Keeps your planned food or sale crop and familiar farm operations."],
   water:"Check crop-stage water needs and local soil moisture before retaining or changing this plan.",
   risks:[sameFamily?"These crops are in the same family; a different crop name alone may not interrupt shared pest cycles.":"A crop-family change may interrupt some pest cycles, but actual pests, host ranges and rotation duration need local review."],
   gaps:["Confirm the previous crop and pest history, input costs and the reason this plan suits your household."],
   sources:[reference("maize",17),reference("soil",6)]};
  if(!current.family||!next.family)baseline.risks=["Fallow does not by itself establish a pest break. Review the preceding crop, vegetation, duration and actual pest history."];
  if(input.current==="groundnut"&&input.next==="groundnut"){
   baseline.risks.push("The Ghana groundnut guide advises rotating groundnut with cereals rather than repeating groundnut.");baseline.sources.push(reference("groundnut",11));
  }
  const perennial=current.perennial||next.perennial;
  if(perennial){
   result.kind="perennial-management";
   result.notice="This plan includes a long-lived crop. These are three management comparisons, not validated annual rotations. Do not remove established cocoa or plantain to follow an annual sequence.";
   const name=current.perennial?currentName:nextName;
   result.strategies=[baseline,
    {id:"residue-perennial",title:"Retain the perennial; manage surface cover",sequence:[name,"Healthy surface residues",name],
     why:"Review soil protection around the established or planned perennial before considering crop replacement.",
     benefits:["Suitable healthy surface residues may protect soil and reduce evaporation."],
     water:"Check root-zone moisture and drainage; residue cover is not a substitute for reliable water.",
     risks:["Keep diseased material out of mulch and review placement, access and crop-specific management with an extension officer."],
     gaps:["Stand age, spacing, shade, disease history and locally appropriate mulch practice are unknown."],sources:[reference("soil",6),reference("soil",7)]},
    {id:"cover-perennial",title:"Explore a compatible ground-cover phase",sequence:[name,"Locally reviewed ground cover",name],
     why:"A managed ground cover may protect exposed spaces where it is compatible with the perennial crop.",
     benefits:["Potential soil-cover and organic-matter benefits; these have not been measured for this farm."],
     water:"Living cover can compete for water and nutrients; confirm a suitable species and how to manage or terminate it.",
     risks:["Do not introduce a competing or invasive cover or assume shade/spacing compatibility."],
     gaps:["Local species, water, light, labour and crop-specific compatibility need expert review."],sources:[reference("conservation",28),reference("cover")]}];
  }else{
   const preferred=["nitrogen","forage","market"].includes(input.priority)?["cowpea","groundnut","maize","sorghum"]:["maize","cowpea","sorghum","groundnut"];
   const candidate=preferred.find(id=>id!==input.current&&id!==input.next&&CROPS[id].family!==current.family);
   const crop=CROPS[candidate],legume=crop.family==="legume";
   const diversify={id:"diversify",title:"Explore a different-family food crop",sequence:[currentName,crop.name],
    why:"Consider "+crop.name.toLowerCase()+" as an alternative to your planned "+nextName.toLowerCase()+". It changes crop family after "+currentName.toLowerCase()+"; local adaptation must be checked before choosing it.",
    benefits:["A different family may help interrupt some pest cycles and diversify farm products.",legume?
     "A well-nodulated legume may fix nitrogen; soil tests, residue handling and other nutrient needs still matter.":"A cereal phase offers a different crop family; it does not itself provide legume nitrogen fixation."],
    water:"No water-saving percentage is known for this switch. Confirm variety, planting window and crop-stage water needs locally.",
    risks:["The crop may not suit local soil, rainfall, pests, available seed, labour or buyers. A different family does not break every pest cycle."],
    gaps:["Compare actual seed/input costs, maturity duration, household food needs and buyers before replacing the planned crop."],
    sources:[reference("maize",17),reference("tomato",6),reference("conservation",28),reference("conservation",82)]};
   if(input.current==="fallow"){
    diversify.title="Explore a food-crop phase";
    diversify.why="Consider "+crop.name.toLowerCase()+" after your reported fallow. Confirm the preceding crop, cover and local planting readiness before choosing it.";
    diversify.benefits[0]="Adds a food-crop possibility; pest-cycle effects depend on crops grown before the fallow.";
   }
   if(candidate==="groundnut"){
    diversify.risks.push("Groundnut needs a moisture and careful harvest/drying plan; weather readings cannot diagnose aflatoxin contamination.");
    diversify.sources.push(reference("groundnut",11));
   }
   const cover={id:"cover-phase",title:"Protect the gap within your rotation",sequence:[currentName,"Managed cover phase",nextName],
    why:gap.known&&gap.days===0?"Your entered calendar has no between-crop gap. Retain suitable surface cover through sowing; a separate living cover crop would need a revised calendar.":
     input.cover==="residues"||input.cover==="living"?"You already report soil cover. Review its timing and compatibility; this option does not assume an extra benefit over your existing practice.":
     "Keep your planned next food crop while reviewing a residue-covered break or, where feasible, a locally adapted living cover phase.",
    benefits:["Suitable surface cover may reduce soil exposure, runoff and evaporation and contribute organic matter."],
    water:dry?"Start with suitable healthy residues. Additional living cover can compete for scarce water; confirm moisture and a termination plan first.":
     "Consider living cover only if water, available time and management allow it to finish without competing with the next crop.",
    risks:["Cover needs labour, seed or residue availability. Retaining the same food-crop family does not create a pest break by itself."],
    gaps:["Choose a locally compatible cover species, management/termination date and residue allocation; a bare gap has not been detected by satellite."],
    sources:[reference("soil",6),reference("soil",7),reference("conservation",19),reference("conservation",28),reference("cover")]};
   if(input.priority==="organic")cover.why+=" Your organic-matter priority makes residue supply, biomass and soil testing important review points.";
   if(input.priority==="erosion")cover.why+=" Your erosion priority makes soil exposure, actual slope and runoff paths important review points.";
   if(input.priority==="water")cover.why+=" Your water priority makes conserving existing moisture and avoiding competition especially relevant.";
   result.strategies=[baseline,diversify,cover];
  }
  for(const strategy of result.strategies){
   if(dry)strategy.risks.push("Recent matched water-loss estimates or declining root-zone moisture, or your reported limited water, make field moisture checks a priority. This is not a drought diagnosis.");
   if(evidence.flags.sloping&&evidence.flags.rain)strategy.risks.push("Recent rain and a sloping terrain screen make runoff paths and soil-cover checks relevant; inspect the actual plot.");
   if(input.soil==="clayey")strategy.risks.push("You report clayey soil: check infiltration and drainage in the field before choosing irrigation or the next crop.");
   if(input.soil==="sandy")strategy.risks.push("You report sandy soil: verify moisture at rooting depth and discuss suitable cover and water management locally.");
   if(input.priority==="forage")strategy.gaps.push("Review forage suitability and how much residue can be removed for livestock while retaining soil cover.");
   if(input.priority==="market")strategy.gaps.push("Local buyers, prices, storage, transport and net returns are unverified; no income gain is promised.");
   if(input.priority==="nitrogen")strategy.gaps.push("Nitrogen fixation depends on the species, nodulation and conditions; this is not a fertilizer-rate recommendation.");
  }
  return result;
 }
 function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
 function suggest(result){
  if(result.prompt)return {title:"Select your rotation crops",text:result.prompt,sources:[],strategyId:null};
  const {input,evidence,gap}=result,current=CROPS[input.current],next=CROPS[input.next];
  const dry=input.water==="limited"||evidence.flags.waterCheck||evidence.flags.rootDrying;
  const sameFamily=current.family&&current.family===next.family;
  const useFoodCrop=sameFamily||(["nitrogen","forage","market"].includes(input.priority)&&
   !(input.priority==="nitrogen"&&next.family==="legume")&&!dry);
  const id=result.kind==="perennial-management"?
   (input.cover==="living"&&input.water==="reliable"&&!dry?"cover-perennial":"residue-perennial"):
   useFoodCrop?"diversify":input.priority==="nitrogen"&&next.family==="legume"?"existing":"cover-phase";
  const strategy=result.strategies.find(item=>item.id===id);
  const sources=[],clauses=[];
  const closing="Confirm local suitability, seed availability and timing with a MoFA extension officer before changing your rotation.";
  const limit=150-closing.split(/\s+/).length;
  function add(text,...refs){
   if([...clauses,text].join(" ").trim().split(/\s+/).length>limit)return;
   clauses.push(text);sources.push(...refs);
  }
  if(result.kind==="perennial-management"){
   const name=current.perennial?current.name:next.name;
   add(current.perennial?"Keep established "+name.toLowerCase()+" in place and review soil cover with your extension officer; do not remove it to introduce an annual rotation.":
    "Before establishing your planned "+name.toLowerCase()+", review long-term spacing, water and soil cover with your extension officer; this is not an annual rotation.",reference("soil",6));
   add(id==="cover-perennial"?"Review your planned living cover for shade, spacing and root competition, and agree how it will be managed or terminated.":
    "Retain suitable healthy surface residues to protect the soil and conserve moisture, checking placement and keeping diseased material out.",reference("soil",7),reference("conservation",28));
  }else if(id==="diversify"){
   const candidate=strategy.sequence[1];
   add(input.current==="fallow"?"Consider "+candidate.toLowerCase()+" after the reported fallow, once local planting readiness and the previous crop history have been checked.":
    "Consider "+current.name.toLowerCase()+" followed by "+candidate.toLowerCase()+", as an alternative to your planned "+next.name.toLowerCase()+". Changing crop family may help interrupt some shared pest cycles.",reference("maize",17),reference("tomato",6));
   if(["Cowpea","Groundnut"].includes(candidate))add("A well-nodulated legume may contribute nitrogen; confirm soil needs and retain suitable healthy residues rather than assuming fertilizer can be omitted.",reference("conservation",82));
   else add("A cereal phase provides a different crop family; check soil needs because it does not supply legume nitrogen fixation.",reference("soil",6));
   if(candidate==="Groundnut")add("For groundnut, arrange moisture checks and careful harvesting and drying.",reference("groundnut",11));
  }else{
   add("Review keeping "+current.name.toLowerCase()+" followed by "+next.name.toLowerCase()+", while retaining suitable healthy residues between crops to protect soil and conserve moisture.",reference("soil",6),reference("conservation",19));
   if(id==="existing")add("Your planned legume can support nitrogen-fixation goals where nodulation is successful; use soil tests to guide nutrient decisions.",reference("maize",17),reference("conservation",82));
  }
  if(gap.error)add("Correct the harvest and next-sowing dates before planning a separate cover phase.");
  if(dry)add(input.water==="limited"?"With your reported limited water, check moisture at rooting depth and avoid adding a living cover that would compete for water.":
   "Recent NASA estimates make a root-zone moisture check a priority; avoid adding a living cover that would compete for water.",reference("soil",7));
  else if(!evidence.rain&&!evidence.water&&!evidence.soil)add("Fresh water-condition evidence is unavailable; inspect soil moisture and drainage before acting.",reference("soil",7));
  else if(evidence.flags.sloping&&evidence.flags.rain)add("After recent rain, inspect runoff paths on sloping parts and keep soil covered.",reference("conservation",20));
  else if(input.soil==="clayey")add("On your reported heavier soil, check drainage before planting or watering.",reference("soil",6));
  if(input.priority==="forage")add("Agree how much residue can be used as forage while keeping enough soil cover.",reference("conservation",28));
  else if(input.priority==="market")add("Confirm local buyers, input costs and storage before changing the crop.",reference("conservation",28));
  else if(input.soil==="sandy")add("On your reported sandy soil, check moisture below the surface before watering.",reference("soil",7));
  if(gap.known&&gap.days>0&&id==="cover-phase")add("Use the "+gap.days+"-day gap in your calendar to plan soil cover; confirm a living cover has enough water and time before introducing it.",reference("cover"));
  else if(gap.known&&gap.days===0)add("Your calendar has no between-crop gap; a separate cover crop would require revised dates.");
  clauses.push(closing);sources.push(reference("soil",6));
  return {title:"Crop rotation suggestion",text:clauses.join(" "),sources,strategyId:id};
 }
 function render(container,result){
  if(!container)return;container.replaceChildren();
  if(result.prompt){container.append(element("p",result.prompt,"rotation-note"));return;}
  const suggestion=suggest(result),card=element("div",undefined,"alert alert-info");
  card.append(element("strong",suggestion.title),element("p",suggestion.text));
  container.append(card);
 }
 let latest={payload:null,point:null,now:null};
 const FIELDS=["current","next","priority","soil","water","cover","harvest","sowing"];
 function values(){return Object.fromEntries(FIELDS.map(key=>[key,document.getElementById("rotation-"+key)?.value||""]));}
 function refresh(){
  const container=document.getElementById("rotation-results");if(!container)return;
  const input=normalize(values()),result=compare(input,latest.payload,latest.point,latest.now??Date.now());render(container,result);
  const status=document.getElementById("rotation-status");if(status)status.textContent=result.prompt||"Your crop rotation suggestion is ready. Review it with your local extension officer.";
 }
 function update(payload,point,now=Date.now()){latest={payload,point,now};if(typeof document!=="undefined")refresh();}
 function start(){
  const form=document.getElementById("rotation-form");if(!form||form.dataset.rotationBound)return;form.dataset.rotationBound="true";
  for(const field of ["current","next"]){const select=document.getElementById("rotation-"+field);select.replaceChildren();
   const empty=element("option",field==="current"?"Select current crop":"Select the next crop in your existing plan");empty.value="";select.append(empty);
   for(const [id,crop] of Object.entries(CROPS)){const option=element("option",crop.name);option.value=id;select.append(option);}
  }
  try{const saved=localStorage.getItem(KEY);if(saved){const input=normalize(JSON.parse(saved));for(const key of FIELDS)document.getElementById("rotation-"+key).value=input[key];}}catch{}
  const changed=()=>{try{localStorage.setItem(KEY,JSON.stringify(normalize(values())));}catch{}refresh();};
  form.addEventListener("input",changed);form.addEventListener("change",changed);
  form.addEventListener("submit",event=>{event.preventDefault();if(form.reportValidity())changed();});refresh();
 }
 return Object.freeze({CROPS,PRIORITIES,SOURCES,normalize,calendar,analyze,compare,suggest,render,update,start});
})();
if(typeof document!=="undefined"){
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",AgroRotationPlanner.start,{once:true});else AgroRotationPlanner.start();
}
if(typeof module!=="undefined"&&module.exports)module.exports=AgroRotationPlanner;
