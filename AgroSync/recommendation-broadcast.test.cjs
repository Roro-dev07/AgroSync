"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const KEY="agrosync.recommendationDraft",NOW=Date.UTC(2026,10,15,12);
const draft=(text="Check soil moisture around pepper roots and clear blocked drains before watering.")=>({
 version:1,text,title:"Pepper - Flowering",location:"Goaso reference point, Ahafo (6.8030, -2.5170)",generatedAt:NOW
});
class Element {
 constructor(value=""){this.value=value;this.dataset={};this.events={};this.children=[];this.disabled=false;this._text="";}
 set textContent(value){this._text=value;this.children=[];}get textContent(){return this._text;}
 setAttribute(){}addEventListener(name,fn){(this.events[name]||=[]).push(fn);}
 appendChild(node){this.children.push(node);}replaceChildren(){this.children=[];}
 reportValidity(){return true;}
 async emit(name,event={}){for(const fn of this.events[name]||[])await fn(event);}
}
async function fixture({record=draft(),initial="",mode="live",allowAdmin=true,storageBlocked=false,onSave=null}={}) {
 const storage=new Map();if(record!==undefined)storage.set(KEY,typeof record==="string"?record:JSON.stringify(record));
 const form=new Element(),status=new Element(),button=new Element(),messageHelp=new Element("Review the message and its sources before sending.");
 const region=new Element(),locality=new Element(),message=new Element(initial);
 button.textContent="Broadcast message";
 form.querySelector=selector=>selector.includes("field-help")?status:button;
 const nodes={"broadcast-region":region,"broadcast-locality":locality,message,"message-help":messageHelp};
 const document={readyState:"loading",events:{},querySelector:()=>form,getElementById:id=>nodes[id]||null,
  createElement:()=>new Element(),addEventListener(name,fn){this.events[name]=fn;}};
 const window=new Element();window.location={assign(){},replace(){}};
 const calls={drafts:[],sends:[],recipients:0,delivery:0};
 const timers=new Map();let nextTimer=0;
 class Clock extends Date {static now(){return NOW;}}
 const context=vm.createContext({document,window,Date:Clock,URL,console,
  setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),crypto:require("node:crypto").webcrypto,
  localStorage:{getItem:key=>{if(storageBlocked)throw Error("Storage blocked");return storage.get(key)||null;}},
  sessionStorage:{getItem:()=>null,setItem(){}},
  AgroSyncBackend:{requireAdmin:async()=>{if(!allowAdmin)throw Error("Admin sign-in required");},
   loginPath:()=>"login.html",getClient:()=>({auth:{onAuthStateChange(){}}})},
  FarmerDB:{getRegions:()=>["Ahafo","Greater Accra"],
   getFarmersByLocality:async()=>{calls.recipients++;return [1];},
   getSMSStatus:async()=>({ready:true,mode,message:"Connection ready."}),
   getBroadcastDelivery:async()=>{calls.delivery++;return {mode,delivery:{total:1,pending:0,processing:0,accepted:0,sent:0,delivered:1,read:0,failed:0,unknown:0,skipped:0}};},
   createBroadcastDraft:async input=>{calls.drafts.push(input);await onSave?.(input);return {id:"11111111-1111-4111-8111-111111111111",recipientCount:1};},
   sendBroadcast:async(id,expectedMode)=>{calls.sends.push({id,expectedMode});return mode==="whatsapp"?
    {mode:"whatsapp",manual:true,whatsappUrl:"https://wa.me/233240000001?text=Test"}:
    {mode:mode==="whatsapp-cloud"?mode:"live",accepted:1,sent:0,delivered:0,read:0,skipped:0,failed:0,unknown:0,processing:0,pending:0};}}
 });
 vm.runInContext(fs.readFileSync(path.join(__dirname,"broadcast.js"),"utf8"),context);
 await document.events.DOMContentLoaded();
 return {form,status,button,messageHelp,region,locality,message,storage,window,calls,
  runTimer:async ms=>{const timer=[...timers].find(([,row])=>row.ms===ms);assert.ok(timer,"Expected timer: "+ms);timers.delete(timer[0]);await timer[1].fn();}};
}
(async()=>{
 for(const mode of ["live","whatsapp","whatsapp-cloud"]) {
  const app=await fixture({mode});
  assert.equal(app.message.value,draft().text);
  assert.match(app.messageHelp.textContent,/Pepper - Flowering/);
  assert.match(app.messageHelp.textContent,/Goaso/);
  assert.equal(app.region.value,"");assert.equal(app.locality.value,"");
  assert.equal(app.calls.drafts.length,0);assert.equal(app.calls.sends.length,0);
  assert.equal(app.calls.recipients,0,"Do not pick recipients automatically");
  const next=draft("A newer recommendation for the selected pepper crop.");
  app.storage.set(KEY,JSON.stringify(next));await app.window.emit("storage",{key:KEY});
  assert.equal(app.message.value,next.text,"Refresh an untouched imported draft");
  assert.equal(app.calls.drafts.length,0);assert.equal(app.calls.sends.length,0);
  app.message.value="Administrator reviewed and edited this advisory.";await app.message.emit("input");
  app.storage.set(KEY,JSON.stringify(draft("Do not overwrite the administrator's message.")));
  await app.window.emit("storage",{key:KEY});await app.window.emit("focus");
  assert.equal(app.message.value,"Administrator reviewed and edited this advisory.");
  assert.equal(app.calls.drafts.length,0);assert.equal(app.calls.sends.length,0);
  app.region.value="Ahafo";app.locality.value="Goaso";
  await app.form.emit("submit",{preventDefault(){}});
  assert.equal(app.calls.drafts.length,1);assert.equal(app.calls.sends.length,1);
  assert.equal(app.calls.drafts[0].message,app.message.value);
  assert.equal(app.calls.drafts[0].region,"Ahafo");assert.equal(app.calls.drafts[0].locality,"Goaso");
  assert.equal(app.calls.sends[0].expectedMode,mode);
  if(mode==="whatsapp-cloud"){
   assert.match(app.status.textContent,/1 accepted/);assert.match(app.status.textContent,/0 delivered/);
   await app.runTimer(5000);assert.equal(app.calls.delivery,1);assert.match(app.status.textContent,/1 delivered/);
   assert.equal(app.calls.sends.length,1,"Polling delivery must never submit a second send");
  }
 }
 console.log("PASS: recommendation prefills the box, leaves recipients unchanged, respects admin edits and sends only through the existing submit handler");
 for(const record of [null,"not JSON",{...draft(),version:2},{...draft(),text:""},{...draft(),text:"x".repeat(1601)},
  {...draft(),generatedAt:NOW+1},{...draft(),generatedAt:NOW-6*3600000-1},
  {...draft(),generatedAt:String(NOW)},{...draft(),title:null},{...draft(),location:null}]) {
  const app=await fixture({record});
  assert.equal(app.message.value,"");assert.equal(app.calls.drafts.length,0);assert.equal(app.calls.sends.length,0);
 }
 const existing=await fixture({initial:"Keep my existing draft"});assert.equal(existing.message.value,"Keep my existing draft");
 const blocked=await fixture({storageBlocked:true});assert.equal(blocked.message.value,"");assert.equal(blocked.button.disabled,false);
 const unauth=await fixture({allowAdmin:false});assert.equal(unauth.message.value,"");assert.equal(unauth.button.disabled,true);
 console.log("PASS: invalid/expired draft rejection, restricted storage fallback, preserved prefilled text and admin sign-in gating");
 const cleared=await fixture();cleared.storage.delete(KEY);await cleared.window.emit("storage",{key:KEY});
 assert.equal(cleared.message.value,"");assert.equal(cleared.calls.sends.length,0);
 const editing=await fixture();editing.message.value="";await editing.message.emit("input");
 editing.storage.set(KEY,JSON.stringify(draft("Keep the admin's intentionally cleared box empty.")));
 await editing.window.emit("storage",{key:KEY});assert.equal(editing.message.value,"");
 let inFlight;
 inFlight=await fixture({onSave:async input=>{
  inFlight.storage.set(KEY,JSON.stringify(draft("A new recommendation while the earlier one is being submitted.")));
  await inFlight.window.emit("storage",{key:KEY});
  assert.equal(inFlight.message.value,input.message,"Do not change an in-flight submission");
  assert.equal(inFlight.message.disabled,true);
 }});
 inFlight.region.value="Ahafo";inFlight.locality.value="Goaso";
 await inFlight.form.emit("submit",{preventDefault(){}});
 assert.equal(inFlight.calls.drafts[0].message,draft().text);
 assert.equal(inFlight.calls.sends.length,1);
 console.log("All recommendation-to-broadcast tests passed. No real messages were sent.");
})().catch(error=>{console.error(error);process.exitCode=1;});
