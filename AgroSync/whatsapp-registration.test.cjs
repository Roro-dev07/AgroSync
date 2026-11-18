"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const row={id:"11111111-1111-4111-8111-111111111111",first_name:"Ama",last_name:"Mensah",region:"Ahafo",locality:"Goaso",phone:"+233240000001",registered_at:"2026-11-15T00:00:00Z"};
function database({installed=true,optedIn=false}={}){
 const writes=[],reads=[];
 const client={auth:{getSession:async()=>({data:{session:{access_token:"test-session"}}})},from:()=>{
  const query={columns:"",input:null,select(columns){this.columns=columns;return this;},order(){return this;},range(){return this;},eq(){return this;},
   insert(input){this.input=input;return this;},
   async single(){
    if(!installed&&this.input.whatsapp_opt_in)return {error:{code:"42703",message:"Missing consent column"}};
    writes.push(this.input);return {data:{...row,...this.input}};
   },
   then(resolve){reads.push(this.columns);return Promise.resolve(!installed&&this.columns.includes("whatsapp_opt_in")?
    {error:{code:"42703",message:"Missing consent column"}}:
    {data:[{...row,...(installed?{whatsapp_opt_in:optedIn,whatsapp_consent_at:optedIn?"2026-11-15T00:00:00Z":null}:{})}]}).then(resolve);}
  };return query;
 }};
 const requests=[];
 const context=vm.createContext({console,AbortSignal,URLSearchParams,
  fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({mode:"whatsapp-cloud",delivery:{delivered:1}})};},
  AgroSyncBackend:{requireAdmin:async()=>({}),getClient:()=>client},
  LocalFarmerDB:{normalizeRegion:x=>x,normalizePhone:x=>x,normalizeLocality:x=>x,getRegions:()=>["Ahafo"]}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,"serverDB.js"),"utf8"),context);
 return {api:vm.runInContext("FarmerDB",context),writes,reads,requests};
}
async function registration(checked){
 const inputs=Object.fromEntries(["firstname","lastname","region","locality","contact"].map(id=>[id,{value:({firstname:"Ama",lastname:"Mensah",region:"Ahafo",locality:"Goaso",contact:row.phone})[id]}]));
 inputs["whatsapp-consent"]={checked};
 const status={setAttribute(){},textContent:""},button={disabled:false},calls=[];
 const form={dataset:{},events:{},addEventListener(name,fn){(this.events[name]||=[]).push(fn);},querySelector:s=>s.includes("field-help")?status:button,reportValidity:()=>true,reset(){}};
 const document={readyState:"loading",events:{},querySelector:()=>form,getElementById:id=>inputs[id],addEventListener(name,fn){this.events[name]=fn;}};
 const context=vm.createContext({document,console,window:{location:{}},
  AgroSyncBackend:{requireAdmin:async()=>({}),getClient:()=>({auth:{onAuthStateChange(){}}})},
  FarmerDB:{registerFarmer:async data=>{calls.push(data);return {fullName:"Ama Mensah",locality:"Goaso",region:"Ahafo"};}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,"registration.js"),"utf8"),context);
 await document.events.DOMContentLoaded();
 for(const fn of form.events.submit)await fn({preventDefault(){}});
 assert.equal(calls.length,1);assert.equal(calls[0].whatsappOptIn,checked);assert.equal(calls[0].phone,row.phone);
}
(async()=>{
 const input={firstName:"Ama",lastName:"Mensah",region:"Ahafo",locality:"Goaso",phone:row.phone};
 const live=database({optedIn:true});
 await live.api.registerFarmer({...input,whatsappOptIn:true});assert.equal(live.writes[0].whatsapp_opt_in,true);
 await live.api.registerFarmer({...input,whatsappOptIn:"true"});assert.ok(!("whatsapp_opt_in" in live.writes[1]),"Only explicit boolean consent is recorded");
 assert.equal((await live.api.getFarmersByLocality("Ahafo","Goaso"))[0].whatsappOptIn,true);
 const old=database({installed:false});
 assert.equal((await old.api.getFarmersByLocality("Ahafo","Goaso"))[0].whatsappOptIn,false);
 assert.equal(old.reads.length,2,"Old schema falls back without treating registrations as WhatsApp opt-ins");
 await old.api.getFarmersByLocality("Ahafo","Goaso");assert.equal(old.reads.length,3);
 await old.api.registerFarmer({...input,whatsappOptIn:false});assert.equal(old.writes.length,1,"Standard registration remains available before migration");
 await assert.rejects(old.api.registerFarmer({...input,whatsappOptIn:true}),/supabase-whatsapp.sql/);
 await live.api.getBroadcastDelivery(row.id);assert.equal(live.requests[0].url,"/api/broadcast-sms?broadcastId="+row.id);
 assert.equal(live.requests[0].options.method,"GET");assert.equal(live.requests[0].options.headers.Authorization,"Bearer test-session");
 await registration(false);await registration(true);
 const html=fs.readFileSync(path.join(__dirname,"registration.html"),"utf8");
 const checkbox=html.match(/<input[^>]+id="whatsapp-consent"[^>]*>/)?.[0];
 assert.ok(checkbox);assert.doesNotMatch(checkbox,/\s(?:checked|required)(?:\s|=|>)/);
 console.log("PASS: explicit optional registration consent, existing phone-number mapping, private authenticated delivery reads and old-schema registry fallback");
 console.log("All WhatsApp registration tests passed. No live database writes were made.");
})().catch(error=>{console.error(error);process.exitCode=1;});
