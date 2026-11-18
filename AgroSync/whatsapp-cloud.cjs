/** Meta WhatsApp Cloud API. Server only; recipients and text come from saved DB jobs. */
"use strict";
const {createHmac,timingSafeEqual}=require("node:crypto");
const COUNTS=["total","pending","processing","accepted","sent","delivered","read","failed","unknown","skipped"];
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MAX_WEBHOOK_BYTES=1048576;
const ghanaPhone=value=>typeof value==="string"&&/^\+?233[235]\d{8}$/.test(value)?"+"+value.replace(/^\+/,""):null;
class WhatsAppError extends Error {constructor(message,status=503){super(message);this.status=status;}}
function whatsappSettings(env) {
 const config={provider:"whatsapp-cloud",mode:"whatsapp-cloud",token:(env.WHATSAPP_ACCESS_TOKEN||"").trim(),
  phoneId:(env.WHATSAPP_PHONE_NUMBER_ID||"").trim(),accountId:(env.WHATSAPP_BUSINESS_ACCOUNT_ID||"").trim(),
  template:(env.WHATSAPP_TEMPLATE_NAME||"").trim(),language:(env.WHATSAPP_TEMPLATE_LANGUAGE||"en_US").trim(),
  version:(env.WHATSAPP_GRAPH_VERSION||"v27.0").trim(),appSecret:(env.WHATSAPP_APP_SECRET||"").trim(),
  verifyToken:(env.WHATSAPP_VERIFY_TOKEN||"").trim(),serviceKey:(env.SUPABASE_SERVICE_ROLE_KEY||"").trim()};
 const fields=[
  [config.token&&!/^YOUR_/i.test(config.token),"WHATSAPP_ACCESS_TOKEN"],
  [/^\d{5,30}$/.test(config.phoneId),"WHATSAPP_PHONE_NUMBER_ID"],
  [/^\d{5,30}$/.test(config.accountId),"WHATSAPP_BUSINESS_ACCOUNT_ID"],
  [/^[a-z][a-z0-9_]{0,511}$/.test(config.template),"WHATSAPP_TEMPLATE_NAME"],
  [/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(config.language),"WHATSAPP_TEMPLATE_LANGUAGE"],
  [/^v\d{1,2}\.0$/.test(config.version),"WHATSAPP_GRAPH_VERSION"],
  [/^[a-f0-9]{32}$/i.test(config.appSecret),"WHATSAPP_APP_SECRET"],
  [config.verifyToken.length>=24&&!/^YOUR_/i.test(config.verifyToken),"WHATSAPP_VERIFY_TOKEN (at least 24 characters)"],
  [/^[\w-]+\.[\w-]+\.[\w-]+$/.test(config.serviceKey),"SUPABASE_SERVICE_ROLE_KEY"]
 ];
 config.problem=fields.find(([valid])=>!valid)?.[1];
 if(config.problem)config.problem="Set "+config.problem+" in the private server settings. Follow WHATSAPP-CLOUD-SETUP.md.";
 return config;
}
function safeEqual(a,b) {
 const first=Buffer.from(a||""),second=Buffer.from(b||"");
 return first.length===second.length&&timingSafeEqual(first,second);
}
function verifySignature(raw,signature,secret) {
 return typeof signature==="string"&&/^sha256=[a-f0-9]{64}$/.test(signature)&&
  safeEqual(signature,"sha256="+createHmac("sha256",secret).update(raw).digest("hex"));
}
function createWhatsAppCloud({env=process.env,fetchImpl=globalThis.fetch,rpc,cache={},ErrorClass=WhatsAppError}={}) {
 const fail=(message,status)=>{throw new ErrorClass(message,status);};
 async function approvedTemplate(config) {
  const key=JSON.stringify([config.accountId,config.template,config.language,config.version,config.token]);
  if(cache.template?.key===key&&Date.now()-cache.template.time<120000)return cache.template.body;
  const query=new URLSearchParams({name:config.template,fields:"name,status,language,components,parameter_format",limit:"100"});
  let response,data;
  try {
   response=await fetchImpl("https://graph.facebook.com/"+config.version+"/"+config.accountId+"/message_templates?"+query,
    {headers:{Authorization:"Bearer "+config.token},signal:AbortSignal.timeout(8000),redirect:"error"});
   data=await response.json();
  }catch{fail("Could not check the approved WhatsApp template. No WhatsApp message was sent.");}
  if(!response.ok)fail("WhatsApp template access was denied or unavailable. Check the Meta token and business account permissions.");
  const matches=Array.isArray(data?.data)?data.data.filter(t=>t.name===config.template&&t.language===config.language):[];
  const template=matches.length===1?matches[0]:null;
  if(template?.status!=="APPROVED")fail("The configured WhatsApp template and language must be approved by Meta before broadcasting.");
  const components=template.components;
  if(template.parameter_format==="NAMED"||!Array.isArray(components)||components.length!==1||components[0].type!=="BODY"||
   typeof components[0].text!=="string"||JSON.stringify(components[0].text.match(/\{\{[^}]+\}\}/g))!==JSON.stringify(["{{1}}","{{2}}"]))
   fail("Use the text-only WhatsApp template in WHATSAPP-CLOUD-SETUP.md: {{1}} is locality, {{2}} is the advisory.");
  const body=components[0].text;
  cache.template={key,time:Date.now(),body};return body;
 }
 function summaryResult(summary,errors=[]) {
  const result={mode:"whatsapp-cloud",errors:[...new Set(errors)]};
  for(const key of COUNTS){if(!Number.isSafeInteger(summary?.[key])||summary[key]<0)fail("WhatsApp delivery totals could not be confirmed. Keep the same broadcast ID before retrying.");result[key]=summary[key];}
  return result;
 }
 async function status(broadcastId) {
  const config=whatsappSettings(env);
  if(config.problem)return {ready:false,mode:config.mode,message:config.problem};
  if(broadcastId){
   if(!UUID.test(broadcastId))fail("A valid saved broadcast ID is required.",400);
   return {ready:true,mode:config.mode,delivery:{broadcastId,...summaryResult(await rpc("agrosync_whatsapp_summary",{p_broadcast_id:broadcastId}))}};
  }
  try {
   const schema=await rpc("agrosync_whatsapp_summary",{p_broadcast_id:"00000000-0000-0000-0000-000000000000"});
   if(schema?.schema_version!==1)fail("Run supabase-whatsapp.sql in Supabase SQL Editor.");
   await approvedTemplate(config);
   return {ready:true,mode:config.mode,message:"WhatsApp delivery is configured. Only farmers who agreed to receive WhatsApp updates are included."};
  }catch(error){return {ready:false,mode:config.mode,message:error.message};}
 }
 async function send(broadcastId) {
  const config=whatsappSettings(env);if(config.problem)fail(config.problem);
  // Both reads finish before claiming recipients or contacting the send endpoint.
  const [preview,templateBody]=await Promise.all([
   rpc("agrosync_whatsapp_preview",{p_broadcast_id:broadcastId}),approvedTemplate(config)
  ]);
  if(typeof preview?.message!=="string"||!preview.message.trim()||typeof preview.locality!=="string")fail("The saved WhatsApp draft could not be confirmed.");
  if(/[\r\n\t]| {4}/.test(preview.message))fail("Use one paragraph without tabs or repeated spaces in the WhatsApp advisory.",400);
  const rendered=templateBody.replace("{{1}}",()=>preview.locality).replace("{{2}}",()=>preview.message);
  if([...rendered].length>1024)fail("The advisory plus locality and template text exceeds the supported 1,024-character WhatsApp message limit. Shorten the message; no recipients were submitted.",400);
  const claim=await rpc("agrosync_whatsapp_claim",{p_broadcast_id:broadcastId,p_sender_id:config.phoneId,p_template:config.template,p_language:config.language});
  if(!UUID.test(claim?.claim_id||"")||!Array.isArray(claim.recipients)||claim.recipients.length>10||
   new Set(claim.recipients).size!==claim.recipients.length||claim.message!==preview.message||claim.locality!==preview.locality)
   fail("The database did not confirm a matching WhatsApp batch. Nothing was submitted.");
  const results=new Array(claim.recipients.length);
  let next=0;
  async function worker() {
   while(next<claim.recipients.length){
    const index=next++,phone=claim.recipients[index];
    const outcome={phone,status:"unknown",message_id:null,error_code:"UnconfirmedWhatsAppSubmission"};
    if(ghanaPhone(phone)!==phone){results[index]={...outcome,status:"failed",error_code:"InvalidStoredPhone"};continue;}
    const body={messaging_product:"whatsapp",recipient_type:"individual",to:phone.slice(1),type:"template",
     biz_opaque_callback_data:JSON.stringify({broadcastId,claimId:claim.claim_id}),
     template:{name:config.template,language:{code:config.language},components:[{type:"body",parameters:[
      {type:"text",text:claim.locality},{type:"text",text:claim.message}]}]}};
    try {
     const response=await fetchImpl("https://graph.facebook.com/"+config.version+"/"+config.phoneId+"/messages",{
      method:"POST",headers:{Authorization:"Bearer "+config.token,"Content-Type":"application/json"},
      body:JSON.stringify(body),signal:AbortSignal.timeout(8000),redirect:"error"});
     let data;try{data=await response.json();}catch{}
     const id=data?.messages?.length===1?data.messages[0]?.id:null;
     if(response.ok&&typeof id==="string"&&/^wamid\.[\w+=/.-]+$/.test(id)&&id.length<=300)
      Object.assign(outcome,{status:"accepted",message_id:id,error_code:null});
     else if(response.status>=400&&response.status<500)Object.assign(outcome,{status:"failed",error_code:
      Number.isSafeInteger(data?.error?.code)?"MetaError"+data.error.code:"MetaHTTP"+response.status});
    }catch{} // An interrupted POST may have succeeded. Do not automatically resend it.
    results[index]=outcome;
   }
  }
  await Promise.all(Array.from({length:Math.min(5,claim.recipients.length)},worker));
  let summary=claim;
  if(results.length){
   const finish=()=>rpc("agrosync_whatsapp_finish",{p_broadcast_id:broadcastId,p_claim_id:claim.claim_id,p_results:results});
   try{summary=await finish();}catch{try{summary=await finish();}catch{fail("WhatsApp results could not be saved. Keep broadcast ID "+broadcastId+" and check delivery records before retrying.");}}
  }
  return {broadcastId,...summaryResult(summary,results.map(r=>r.error_code).filter(Boolean))};
 }
 return {status,send};
}
function createWhatsAppWebhook({env=process.env,fetchImpl=globalThis.fetch,projectUrl="https://vthwllinprcweahbxqyu.supabase.co"}={}) {
 const reply=(status,text)=>({status,text});
 return async ({method,url,signature,raw=Buffer.alloc(0)})=>{
  const config=whatsappSettings(env);
  if(method==="GET"){
   // Meta can verify the callback before sender credentials/templates are ready.
   if(config.verifyToken.length<24||/^YOUR_/i.test(config.verifyToken))return reply(503,"Configure the webhook verification token first.");
   const query=new URL(url,"http://localhost").searchParams;
   const challenge=query.get("hub.challenge");
   return query.get("hub.mode")==="subscribe"&&safeEqual(query.get("hub.verify_token"),config.verifyToken)&&/^\d{1,100}$/.test(challenge||"")?
    reply(200,challenge):reply(403,"Webhook verification failed.");
  }
  if(method!=="POST")return reply(405,"Method not allowed.");
  if(config.problem)return reply(503,"WhatsApp webhook is not configured.");
  if(raw.length>MAX_WEBHOOK_BYTES)return reply(413,"Webhook request too large.");
  if(!verifySignature(raw,signature,config.appSecret))return reply(403,"Invalid webhook signature.");
  let data;try{data=JSON.parse(raw.toString("utf8"));}catch{return reply(400,"Invalid JSON.");}
  if(data?.object!=="whatsapp_business_account")return reply(200,"Ignored.");
  const events=[];
  for(const entry of Array.isArray(data.entry)?data.entry:[]){
   if(entry.id!==config.accountId)continue;
   for(const change of Array.isArray(entry.changes)?entry.changes:[]){
    const value=change?.value;
    if(change?.field!=="messages"||value?.metadata?.phone_number_id!==config.phoneId)continue;
    for(const status of Array.isArray(value.statuses)?value.statuses:[]){
     const phone=ghanaPhone(status?.recipient_id);
     if(!phone||!["sent","delivered","read","failed"].includes(status?.status)||typeof status.id!=="string"||status.id.length>300)continue;
     let callback;try{callback=JSON.parse(status.biz_opaque_callback_data);}catch{}
     const timestamp=Number(status.timestamp);
     if(!Number.isSafeInteger(timestamp)||timestamp<=0||timestamp>Date.now()/1000+300)continue;
     events.push({kind:"status",phone,message_id:status.id,status:status.status,timestamp,
      broadcast_id:UUID.test(callback?.broadcastId||"")?callback.broadcastId:null,
      claim_id:UUID.test(callback?.claimId||"")?callback.claimId:null,
      error_code:Number.isSafeInteger(status.errors?.[0]?.code)?"MetaError"+status.errors[0].code:null});
    }
    for(const message of Array.isArray(value.messages)?value.messages:[]){
     const phone=ghanaPhone(message?.from);
     if(phone&&message.type==="text"&&/^(stop|unsubscribe|cancel)$/i.test(message.text?.body?.trim()||""))
      events.push({kind:"optout",phone});
    }
   }
  }
  if(!events.length)return reply(200,"OK");
  try {
   for(let offset=0;offset<events.length;offset+=100){
    const response=await fetchImpl(projectUrl+"/rest/v1/rpc/agrosync_whatsapp_events",{
     method:"POST",headers:{apikey:config.serviceKey,Authorization:"Bearer "+config.serviceKey,"Content-Type":"application/json"},
     body:JSON.stringify({p_sender_id:config.phoneId,p_events:events.slice(offset,offset+100)}),
     signal:AbortSignal.timeout(10000),redirect:"error"});
    if(!response.ok)throw Error("Database webhook update failed");
   }
  }catch{return reply(503,"Delivery update unavailable; retry later.");}
  return reply(200,"OK");
 };
}
module.exports={whatsappSettings,createWhatsAppCloud,createWhatsAppWebhook,verifySignature,WhatsAppError,COUNTS,MAX_WEBHOOK_BYTES};
