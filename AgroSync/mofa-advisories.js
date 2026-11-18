/**
 * Curated Ghana production guidance plus reviewed FAO conservation principles.
 * Documents are evidence, never executable instructions. No diagnosis, pesticide dose,
 * fertilizer rate, drought declaration, or inferred irrigation quantity is generated.
 */
"use strict";
const MoFAAdvisories = (() => {
  const SOURCES = Object.freeze({
    maize:{title:"MoFA Maize Production Guide",year:"2020",publisher:"MoFA / DAES",file:"GUIDE_TO_MAIZE_PRODUCTION.pdf",url:"https://www.mofa.gov.gh/site/images/pdf/production_guides/GUIDE_TO_MAIZE_PRODUCTION.pdf",status:"production-guide"},
    tomato:{title:"MoFA Tomato Production Guide",year:"2020",publisher:"MoFA / DAES",file:"TOMATO_Production_Guide.pdf",url:"https://www.mofa.gov.gh/site/images/pdf/production_guides/TOMATO_Production_Guide.pdf",status:"production-guide"},
    pepper:{title:"MoFA Pepper Production Guide",year:"2020",publisher:"MoFA / DAES",file:"Pepper_Production.pdf",url:"https://www.mofa.gov.gh/site/images/pdf/production_guides/Pepper_Production.pdf",status:"production-guide"},
    cabbage:{title:"MoFA Cabbage Production Guide",year:"2021",publisher:"MoFA / DAES",file:"cabbage_complete_2021.pdf",url:"https://www.mofa.gov.gh/site/images/pdf/production_guides/cabbage_complete_2021.pdf",status:"production-guide"},
    soil:{title:"MoFA / CSIR Soil and Water Management Manual",year:"2018",publisher:"MoFA / DAES and CSIR",url:"https://mofa.gov.gh/site/images/pdf/production_guides/Manual_on_Soil_Nutrient_Management.pdf",status:"extension-manual"},
    facts2021:{title:"Agriculture in Ghana: Facts and Figures 2021",shortTitle:"MoFA Facts & Figures 2021",year:"2022 publication; 2021 data",publisher:"MoFA / SRID",file:"AGRICULTURE IN GHANA (Facts & Figures) 2021.pdf",url:"https://mofa.gov.gh/site/images/pdf/AGRICULTURE%20IN%20GHANA%20%28Facts%20%26%20Figures%29%202021.pdf",status:"historical-context"},
    facts2024:{title:"Agriculture in Ghana: Facts and Figures 2024",shortTitle:"MoFA Facts & Figures 2024",year:"2025 publication; 2024 data",publisher:"MoFA / SRID",file:"AGRICULTURE IN GHANA (Facts & Figures) 2024.pdf",url:"https://srid.mofa.gov.gh/sites/default/files/2025-12/AGRICULTURE%20IN%20GHANA%20%28Facts%20%26%20Figures%29%202024.pdf",status:"historical-context"},
    conservation:{title:"Green manure/cover crops and crop rotation in Conservation Agriculture on small farms",shortTitle:"FAO conservation guide",year:"2011",publisher:"FAO; Paraguay field experience",file:"Green manurecover crops and crop rotation in Conservation Agriculture rotation in Conservation Agriculture on small farms.pdf",url:"https://www.fao.org/fileadmin/user_upload/agp/icm12.pdf",status:"general-conservation-reference"},
    cocoa:{title:"National Implementation Guide for GS ARS 1000 Part 1",year:"2023",publisher:"Ghana Standards Authority / COCOBOD contributors",file:"national-implementation-guide-for-gs-ars-1000-part-1.pdf",status:"management-standard"},
    facts:{title:"Agriculture in Ghana: Facts and Figures 2018",year:"2019 publication; 2018 data",publisher:"MoFA / SRID",file:"AGRIC IN GHANA F&F_2018.pdf",status:"historical-context"},
    cassava:{title:"Cassava Development in Ghana: country case study",year:"historical; publication date not verified",publisher:"Prepared by MoFA; hosted by FAO",url:"https://www.fao.org/4/a0154e/A0154E07.HTM",status:"historical-context"},
    working:{title:"Cassava and plantain working notes",year:"undated",publisher:"User-supplied; author and institutional provenance unverified",file:"4_6023934268227461554.pdf",status:"unverified-working-note"}
  });
  const CROPS=Object.freeze({general:"General / crop not selected",maize:"Maize",tomato:"Tomato",pepper:"Pepper",
    cabbage:"Cabbage",cassava:"Cassava",plantain:"Plantain",cocoa:"Cocoa"});
  const STAGES=Object.freeze({unspecified:"Stage not specified",planning:"Planning / before planting",
    nursery:"Nursery / establishment",transplanting:"Transplanting",vegetative:"Vegetative growth",
    flowering:"Flowering / tasselling / silking",fruiting:"Fruit / head / grain development",mature:"Maturing / harvest"});
  const DAY=86400000;
  const numeric=value=>typeof value==="number"&&Number.isFinite(value);
  const validContext=(crop,stage)=>({
    crop:Object.prototype.hasOwnProperty.call(CROPS,crop)?crop:"general",
    stage:Object.prototype.hasOwnProperty.call(STAGES,stage)?stage:"unspecified"
  });
  function citation(id,page,section) {
    const source=SOURCES[id];
    if(!source)throw new Error("Unknown guidance source.");
    return {id,page:page||null,section:section||null,title:source.title,shortTitle:source.shortTitle||source.title,year:source.year,publisher:source.publisher,status:source.status,
      href:(source.url||"/MoFA/"+encodeURIComponent(source.file))+
        (section?"#"+section:page?"#page="+page:"")};
  }
  function complete24(row,now) {
    return numeric(row?.value)&&row.value>=0&&numeric(row.start)&&numeric(row.end)&&
      row.end-row.start===DAY&&row.end<=now&&now-row.end<=90*60000;
  }
  function dailyEstimate(row,units,now) {
    if(!numeric(row?.value)||row.value<0||!units.includes(row.unit)||!/^\d{4}-\d{2}-\d{2}$/.test(row.date||""))return null;
    const time=Date.parse(row.date+"T00:00:00Z");
    if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==row.date||
        time+DAY>now||now-time>3*DAY)return null;
    return row;
  }
  function assess({rain24,referenceET24,weatherStale,nasaDaily,nasaStale,terrainGradient,terrainStale,now}) {
    const currentRain=!weatherStale&&complete24(rain24,now)?rain24:null;
    const rainUnits=["mm/day","mm d-1","mm"],nasa=nasaStale?{}:(nasaDaily||{});
    const satelliteRain=dailyEstimate(nasa.satelliteRain,rainUnits,now);
    const modelRain=dailyEstimate(nasa.modelRain,rainUnits,now);
    const et=dailyEstimate(nasa.evapotranspiration,["mm/day"],now);
    const sameCurrentPeriod=currentRain&&complete24(referenceET24,now)&&
      currentRain.start===referenceET24.start&&currentRain.end===referenceET24.end;
    const nasaRain=!satelliteRain?modelRain:!modelRain?satelliteRain:
      modelRain.date>satelliteRain.date?modelRain:satelliteRain;
    // Conflicting satellite/model rainfall is not a defensible water-loss comparison.
    const sameNASADay=et&&modelRain&&et.date===modelRain.date&&nasaRain?.date===modelRain.date&&nasaRain.value===modelRain.value;
    const rain=currentRain||nasaRain;
    const waterPressure=sameCurrentPeriod?referenceET24.value>currentRain.value:
      !currentRain&&sameNASADay?et.value>modelRain.value:false;
    return {rain,wet:!!rain&&rain.value>0,currentRain:!!currentRain,
      rainDate:currentRain?null:rain?.date||null,waterPressure,
      waterSource:waterPressure?(sameCurrentPeriod?"reference-et":"nasa-et"):null,
      waterDate:waterPressure&&!sameCurrentPeriod?et.date:null,
      sloping:!terrainStale&&numeric(terrainGradient)&&terrainGradient>0&&terrainGradient<=1000};
  }
  // One actionable paragraph. Weather selects field checks, never a diagnosis or dose.
  function generate({crop="general",stage="unspecified",rain24=null,referenceET24=null,
      weatherStale=false,nasaDaily=null,nasaStale=false,terrainGradient=null,terrainStale=false,now=Date.now()}={}) {
    ({crop,stage}=validContext(crop,stage));
    const item={id:"recommendation",crop,stage,title:CROPS[crop]+" - "+STAGES[stage],
      text:"",type:"info",sources:[],trigger:"Selected crop and stage"};
    const result=text=>{item.text=text;return [item];};
    if(crop==="general") {
      item.title="Select a crop and growth stage";
      return result("Choose a crop and its actual growth stage. A short recommendation will then explain the next field actions using available weather conditions and guidance published on MoFA's website.");
    }
    if(stage==="unspecified") {
      item.title="Select the actual crop stage";
      return result("Select the actual growth stage of your "+CROPS[crop].toLowerCase()+" crop. This helps match planting, watering and crop-care advice to what is happening in your field.");
    }
    const evidence=assess({rain24,referenceET24,weatherStale,nasaDaily,nasaStale,terrainGradient,terrainStale,now});
    const fresh=!!evidence.rain,wet=evidence.wet;
    const planning=stage==="planning";
    item.trigger=fresh?(evidence.currentRain?(wet?"Recent complete rainfall estimate > 0 mm":"Recent complete rainfall estimate = 0 mm"):
      "Dated NASA rainfall estimate: "+evidence.rainDate):
      "Weather unavailable; field checks and stage guidance only";
    item.evidence=evidence;
    let condition;
    if(planning) {
      condition=wet?"Rain is estimated for the past day. Inspect the intended plot for standing water and check drainage before planting.":
        fresh?"No rain is estimated for the past day. Confirm moisture at planting depth and a reliable water supply before planting.":
        "Fresh weather readings are unavailable. Check the plot's moisture and local conditions before deciding when to plant.";
    } else {
      condition=wet?"Rain is estimated for the past day. Check the plot for standing water and clear blocked drains before adding water.":
        fresh?"No rain is estimated for the past day. Check soil below the surface before deciding whether watering is needed.":
        "Fresh weather readings are unavailable. Check the soil and plants in your field before deciding whether watering is needed.";
    }
    if(evidence.rainDate) {
      condition="NASA's daily estimate for "+evidence.rainDate+(wet?" indicates rain. Inspect drainage and check the soil before adding water.":
        " indicates no rain. Check moisture at rooting depth before deciding whether to water.");
      if(planning)condition+=" Confirm planting moisture in the field before sowing.";
    }
    function finish(text) {
      const extras=[];
      if(evidence.waterPressure&&!(crop==="maize"&&stage==="mature")) {
        extras.push({id:evidence.waterSource,text:evidence.waterSource==="nasa-et"?
          "NASA estimates for "+evidence.waterDate+" suggest water loss exceeded rainfall; check the root zone and retain suitable dry surface cover to conserve moisture.":
          "Reference water demand exceeded rain over the same 24 hours; check the root zone and retain suitable dry surface cover to conserve moisture.",
          sources:[citation("conservation",19)]});
      }
      if(wet&&evidence.sloping) {
        extras.push({id:"runoff-field-check",text:"On sloping parts of the plot, retain suitable healthy residues as surface cover and inspect runoff paths; avoid leaving soil bare.",
          sources:[citation("conservation",20)]});
      } else if(planning) {
        extras.push({id:"cover-rotation-planning",text:"Plan a locally adapted cover crop within a suitable rotation; check compatibility with your food crop and available labour before introducing it.",
          sources:[citation("conservation",28),citation("conservation",83)]});
      } else if(stage==="mature"&&!["cocoa","plantain"].includes(crop)) {
        extras.push({id:"post-harvest-cover",text:"When this crop is finished, retain suitable healthy residues as surface cover and plan a locally suitable rotation for the next crop.",
          sources:[citation("conservation",81),citation("conservation",83)]});
      }
      if(planning)extras.push({id:"ghana-seasonal-planning",text:"Confirm the local rainy-season pattern with your extension officer; calendar dates alone do not establish this year's rain onset.",
        sources:[citation("facts2024",21)]});
      else if(wet)extras.push({id:"soil-drainage-priority",text:"Inspect valley bottoms and heavier soil patches first for water collecting around roots.",
        sources:[citation("facts2021",17)]});
      item.appliedRules=[];
      for(const extra of extras) {
        if((text+" "+extra.text).trim().split(/\s+/).length>150)continue;
        text+=" "+extra.text;item.sources.push(...extra.sources);item.appliedRules.push(extra.id);
      }
      return result(text);
    }
    function advice(text,...pages) {
      return {text,sources:pages.map(page=>citation(crop,page))};
    }
    const actions={
      maize:{
        planning:()=>advice("Review crop-family history, plan a suitable rotation and arrange a soil test before choosing fertilizer. Ask your local MoFA extension officer to confirm planting readiness.",17),
        nursery:()=>advice("During maize establishment, check moisture around the developing roots and keep the soil well drained. Arrange supplementary water if field checks show the soil is drying.",7,9),
        vegetative:()=>advice("During vegetative growth, check moisture around the roots and provide supplementary water if the soil is drying. Keep the field well drained to support healthy growth.",7,9),
        flowering:()=>advice("At tasselling and silking, prioritise checking moisture around the roots. If the soil is drying, arrange supplementary irrigation to keep water available during pollination and grain setting.",7),
        fruiting:()=>advice("During grain development, check soil moisture and crop condition before irrigating. Keep water available when field checks show a need, and maintain drainage around the crop.",7,9),
        mature:()=>advice("For mature maize, check that cobs are ready before harvesting. Protect harvested grain from rain, dry it evenly on raised pallets and confirm it is sufficiently dry before storage.",28,29)
      },
      tomato:{
        planning:()=>advice("Review crop-family history. Avoid planting tomato immediately after tomato or pepper; discuss an unrelated rotation such as maize or cowpea with your extension officer. Choose a well-drained site with a reliable water source.",6,5),
        nursery:()=>advice("For tomato seedlings, provide light shade after emergence and keep nursery beds well drained. Avoid overwatering and inspect seedlings before moving them into the field.",8,16),
        transplanting:()=>advice("Transplant ready tomato seedlings in the early morning or late afternoon. Water seedlings before moving them, and check that the planting beds drain freely.",8,7),
        vegetative:()=>advice("As tomato plants grow, provide stakes or cages to support them and keep developing fruit off the ground. Check root-zone moisture before supplementary irrigation.",8,5),
        flowering:()=>advice("During tomato flowering, maintain a reliable water supply and check moisture around the roots before watering. Keep drains clear because tomato does poorly in waterlogged soil.",5),
        fruiting:()=>advice("Support developing tomato fruit with stakes or cages so it stays off the ground. Check soil moisture before supplementary irrigation and keep the field well drained.",8,5),
        mature:()=>advice("Inspect mature tomato fruit for cracking after rain, especially where a hot, dry spell came first. Check field moisture and maintain a reliable water supply without leaving the soil waterlogged.",5)
      },
      pepper:{
        planning:()=>advice("Choose a well-drained site and review crop-family history. Avoid following pepper or tomato with another closely related crop; discuss a suitable unrelated rotation with your extension officer.",7),
        nursery:()=>advice("Keep pepper nursery soil moist rather than wet, using gentle watering when needed. Provide light shade over young seedlings and remove weeds carefully.",12),
        transplanting:()=>advice("Transplant ready pepper seedlings in the early morning, late afternoon or on a cloudy day. Water seedlings before and after transplanting, checking that the field drains freely.",13),
        vegetative:()=>advice("During pepper growth, maintain suitable soil moisture with supplementary irrigation when needed. Control weeds and use suitable mulch to help conserve water.",16),
        flowering:()=>advice("During pepper flowering, keep moisture steady around the roots. Provide supplementary irrigation when field checks show the soil is drying, and control weeds that compete for water.",16),
        fruiting:()=>advice("During pepper fruit development, maintain steady soil moisture. Provide supplementary irrigation when needed, control weeds and use suitable mulch to help conserve water.",16),
        mature:()=>advice("As pepper fruit matures, continue checking field moisture before watering. Maintain a suitable water supply for the growing crop and keep weeds under control.",16)
      },
      cabbage:{
        planning:()=>advice("Choose a well-drained site with a reliable water source. Plan suitable soil cover to help retain moisture, and use soil-test results to guide fertilizer choices.",6,8),
        nursery:()=>advice("For cabbage seedlings, provide light shade after emergence and remove weak or overcrowded seedlings. Check bed moisture and drainage before watering.",7),
        transplanting:()=>advice("Transplant ready cabbage seedlings in the early morning or late afternoon. Water after transplanting and check drainage so the seedlings are not left in standing water.",7),
        vegetative:()=>advice("During cabbage growth, water regularly when the soil needs it, using clean water. Avoid overwatering and maintain suitable soil cover to retain moisture.",8),
        fruiting:()=>advice("During cabbage head formation, keep soil moisture consistent with regular watering when needed. Avoid overwatering; steady moisture helps heads develop evenly and reduces splitting.",8),
        mature:()=>advice("Reduce watering as cabbage heads mature, after checking their maturity and the soil. Avoid overwatering and use clean water whenever irrigation is still needed.",8)
      }
    };
    const action=actions[crop]?.[stage]?.();
    if(action) {
      item.sources=action.sources;
      // Drainage advice has a separately reviewed page in each production guide.
      if(wet||planning)item.sources.push(citation(crop,{maize:9,tomato:5,pepper:7,cabbage:6}[crop]));
      if(crop==="maize"&&stage==="mature") {
        condition=wet?"Rain is estimated for the past day. Keep harvested cobs and drying grain protected from showers.":
          fresh?"No rain is estimated for the past day. Check local conditions before putting harvested maize out to dry.":
          "Fresh weather readings are unavailable. Check local conditions before harvesting or putting maize out to dry.";
        if(evidence.rainDate)condition="NASA rainfall information is dated "+evidence.rainDate+". Check local conditions and protect harvested cobs before putting maize out to dry.";
      }
      return finish(condition+" "+action.text);
    }
    // Generic care is explicitly labelled: no unverified crop/stage rules are invented.
    item.sources=[citation("soil",6),citation("soil",7)];
    const general=planning?"Choose a well-drained site and retain suitable soil cover to conserve moisture and reduce erosion.":
      "Maintain suitable dry plant material as soil cover to conserve moisture and reduce erosion. Drain standing water where needed.";
    return finish(condition+" "+general+" This is general soil-care guidance for "+CROPS[crop].toLowerCase()+
      "; ask your local MoFA extension officer for advice specific to the selected crop stage.");
  }
  function render(container,recommendations) {
    if(!container)return;
    container.replaceChildren();
    const item=recommendations[0];
    if(!item)return;
    const block=document.createElement("div"),heading=document.createElement("strong"),body=document.createElement("p");
    block.className="alert alert-"+item.type;
    heading.textContent=item.title;body.textContent=item.text;
    block.append(heading,body);
    container.append(block);
  }
  return Object.freeze({SOURCES,CROPS,STAGES,validContext,generate,render});
})();
if(typeof module!=="undefined"&&module.exports)module.exports=MoFAAdvisories;

