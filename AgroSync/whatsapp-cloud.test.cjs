"use strict";
const assert=require("node:assert/strict"),crypto=require("node:crypto"),path=require("node:path"),{pathToFileURL}=require("node:url");
const {createSMSService}=require("./broadcast-sms.cjs");
const {createWhatsAppWebhook,whatsappSettings}=require("./whatsapp-cloud.cjs");
const {deploymentCommands}=require("./deploy-netlify.cjs");
const ADMIN="e7a38ce9-8104-4022-a137-8cca64113d2d",ID="11111111-1111-4111-8111-111111111111",CLAIM="22222222-2222-4222-8222-222222222222";
const AUTH="Bearer test-admin-session",PHONE="+233240000001",TEXT="Check soil moisture before watering and retain suitable surface cover.";
const TEMPLATE="AgroSync advisory for {{1}}. Field action: {{2}}. Check your plot before acting. Reply STOP to stop these updates.";
const ENV={SMS_PROVIDER:"whatsapp-cloud",WHATSAPP_ACCESS_TOKEN:"META_PRIVATE_TEST_TOKEN",WHATSAPP_PHONE_NUMBER_ID:"1234567890",
 WHATSAPP_BUSINESS_ACCOUNT_ID:"9876543210",WHATSAPP_TEMPLATE_NAME:"agrosync_advisory",WHATSAPP_TEMPLATE_LANGUAGE:"en_US",
 WHATSAPP_GRAPH_VERSION:"v27.0",WHATSAPP_APP_SECRET:"0123456789abcdef0123456789abcdef",WHATSAPP_VERIFY_TOKEN:"test-verify-token-at-least-24-characters",
 SUPABASE_SERVICE_ROLE_KEY:"test.private.service_role"};
const reply=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const empty=()=>({schema_version:1,total:1,pending:0,processing:0,accepted:0,sent:0,delivered:0,read:0,failed:0,unknown:0,skipped:0});
function fixture({env=ENV,user=ADMIN,message=TEXT,numbers=[PHONE],templateStatus="APPROVED",providerStatus=200,
 providerData={messages:[{id:"wamid.test123"}]},timeout=false,finishFails=0,claimMismatch=false}={}) {
 const calls=[];let claimed=false,summary=empty();summary.total=numbers.length;
 const fetchImpl=async(url,options={})=>{
  calls.push({url,options});
  if(url.endsWith("/auth/v1/user"))return reply({id:user});
  if(url.includes("/rest/v1/rpc/")){
   assert.equal(options.headers.Authorization,AUTH);
   const name=url.split("/").at(-1),body=JSON.parse(options.body);
   if(name==="agrosync_whatsapp_summary")return reply(summary);
   if(name==="agrosync_whatsapp_preview")return reply({message,locality:"Goaso"});
   if(name==="agrosync_whatsapp_claim"){
    assert.equal(body.p_sender_id,ENV.WHATSAPP_PHONE_NUMBER_ID);assert.equal(body.p_template,"agrosync_advisory");
    const recipients=claimed?[]:numbers;claimed=true;
    return reply({...summary,claim_id:CLAIM,recipients,message:claimMismatch?"Changed draft":message,locality:"Goaso"});
   }
   if(name==="agrosync_whatsapp_finish"){
    assert.equal(body.p_broadcast_id,ID);assert.equal(body.p_claim_id,CLAIM);
    if(finishFails-->0)throw Error("Synthetic lost database response");
    summary=empty();summary.total=numbers.length;
    for(const row of body.p_results)summary[row.status]++;
    return reply(summary);
   }
   throw Error("Unexpected RPC: "+name);
  }
  assert.equal(new URL(url).hostname,"graph.facebook.com");
  assert.equal(options.headers.Authorization,"Bearer "+ENV.WHATSAPP_ACCESS_TOKEN);
  if(url.includes("/message_templates?"))return reply({data:[{name:"agrosync_advisory",language:"en_US",status:templateStatus,parameter_format:"POSITIONAL",components:[{type:"BODY",text:TEMPLATE}]}]});
  assert.equal(url,"https://graph.facebook.com/v27.0/1234567890/messages");
  assert.equal(options.method,"POST");assert.equal(options.redirect,"error");
  if(timeout)throw Error("Synthetic provider timeout");
  return reply(providerData,providerStatus);
 };
 return {service:createSMSService({env,fetchImpl}),calls};
}
const sends=f=>f.calls.filter(c=>c.url.endsWith("/messages"));
const claims=f=>f.calls.filter(c=>c.url.endsWith("/agrosync_whatsapp_claim"));
(async()=>{
 const live=fixture();assert.equal((await live.service.status(AUTH)).ready,true);assert.equal(sends(live).length,0);
 const sent=await live.service.send(AUTH,ID,"whatsapp-cloud");assert.equal(sent.accepted,1);assert.equal(sent.delivered,0);
 const body=JSON.parse(sends(live)[0].options.body);
 assert.equal(body.to,PHONE.slice(1));assert.equal(body.type,"template");
 assert.equal(body.template.name,"agrosync_advisory");assert.equal(body.template.components[0].parameters[1].text,TEXT);
 assert.deepEqual(JSON.parse(body.biz_opaque_callback_data),{broadcastId:ID,claimId:CLAIM});
 await live.service.send(AUTH,ID,"whatsapp-cloud");assert.equal(sends(live).length,1,"A duplicate click must not send again");
 assert.equal((await live.service.status(AUTH,ID)).delivery.accepted,1);
 assert.ok(!JSON.stringify(sent).includes(PHONE));assert.ok(!JSON.stringify(sent).includes(ENV.WHATSAPP_ACCESS_TOKEN));
 const many=fixture({numbers:[PHONE,"+233240000002"],providerData:{messages:[{id:"wamid.batch"}]}});
 await many.service.send(AUTH,ID,"whatsapp-cloud");
 assert.deepEqual(sends(many).map(c=>JSON.parse(c.options.body).to).sort(),["233240000001","233240000002"]);
 assert.ok(sends(many).every(c=>!JSON.parse(c.options.body).to.includes(",")),"Send an individual request to each database recipient");
 const outsider=fixture({user:"other-user"});await assert.rejects(outsider.service.send(AUTH,ID,"whatsapp-cloud"),e=>e.status===403);assert.equal(sends(outsider).length,0);
 await assert.rejects(fixture().service.send(undefined,ID,"whatsapp-cloud"),e=>e.status===401);
 const changed=fixture();await assert.rejects(changed.service.send(AUTH,ID,"live"),e=>e.status===409);assert.equal(claims(changed).length,0);
 const incomplete=fixture({env:{...ENV,WHATSAPP_ACCESS_TOKEN:""}});assert.equal((await incomplete.service.status(AUTH)).ready,false);
 await assert.rejects(incomplete.service.send(AUTH,ID,"whatsapp-cloud"),/WHATSAPP_ACCESS_TOKEN/);assert.equal(claims(incomplete).length,0);
 const pending=fixture({templateStatus:"PENDING"});await assert.rejects(pending.service.send(AUTH,ID,"whatsapp-cloud"),/approved/);assert.equal(claims(pending).length,0);
 for(const message of ["x".repeat(1100),"Do this.\nDo that."]){const f=fixture({message});await assert.rejects(f.service.send(AUTH,ID,"whatsapp-cloud"));assert.equal(claims(f).length,0);assert.equal(sends(f).length,0);}
 const mismatch=fixture({claimMismatch:true});await assert.rejects(mismatch.service.send(AUTH,ID,"whatsapp-cloud"),/matching WhatsApp batch/);assert.equal(sends(mismatch).length,0);
 for(const options of [{timeout:true},{providerStatus:503},{providerData:{messages:[]}}]){
  const f=fixture(options);assert.equal((await f.service.send(AUTH,ID,"whatsapp-cloud")).unknown,1);
  await f.service.send(AUTH,ID,"whatsapp-cloud");assert.equal(sends(f).length,1,"Uncertain POSTs must never automatically repeat");
 }
 const rejected=fixture({providerStatus:400,providerData:{error:{code:131026,message:"PRIVATE PROVIDER DETAIL"}}});
 const failure=await rejected.service.send(AUTH,ID,"whatsapp-cloud");assert.equal(failure.failed,1);assert.deepEqual(failure.errors,["MetaError131026"]);assert.ok(!JSON.stringify(failure).includes("PRIVATE"));
 const retry=fixture({finishFails:1});await retry.service.send(AUTH,ID,"whatsapp-cloud");assert.equal(sends(retry).length,1);
 console.log("PASS: admin-only database recipients, approved templates, exact text, per-number requests, readiness, size guards, duplicate protection and timeout-safe results");

 const stored=[];
 const webhook=createWhatsAppWebhook({env:ENV,fetchImpl:async(url,options)=>{
  assert.ok(url.endsWith("/rpc/agrosync_whatsapp_events"));assert.equal(options.headers.apikey,ENV.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(options.headers.Authorization,"Bearer "+ENV.SUPABASE_SERVICE_ROLE_KEY);stored.push(JSON.parse(options.body));return reply({ok:true});
 }});
 const handshake="https://example.test/api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token="+ENV.WHATSAPP_VERIFY_TOKEN+"&hub.challenge=123456";
 assert.deepEqual(await webhook({method:"GET",url:handshake}),{status:200,text:"123456"});
 assert.equal((await webhook({method:"GET",url:handshake.replace(ENV.WHATSAPP_VERIFY_TOKEN,"wrong")})).status,403);
 const verificationOnly=createWhatsAppWebhook({env:{WHATSAPP_VERIFY_TOKEN:ENV.WHATSAPP_VERIFY_TOKEN},fetchImpl:async()=>{throw Error("Verification must not contact Meta or the database");}});
 assert.deepEqual(await verificationOnly({method:"GET",url:handshake}),{status:200,text:"123456"});
 assert.equal((await verificationOnly({method:"GET",url:handshake.replace(ENV.WHATSAPP_VERIFY_TOKEN,"wrong")})).status,403);
 assert.equal((await verificationOnly({method:"POST",url:handshake})).status,503,"Verification alone must never enable sending or unsigned receipt processing");
 assert.equal((await createWhatsAppWebhook({env:{}})({method:"GET",url:handshake})).status,503);
 const data={object:"whatsapp_business_account",entry:[{id:ENV.WHATSAPP_BUSINESS_ACCOUNT_ID,changes:[{field:"messages",value:{
  metadata:{phone_number_id:ENV.WHATSAPP_PHONE_NUMBER_ID},
  statuses:[{id:"wamid.test123",status:"delivered",timestamp:String(Math.floor(Date.now()/1000)),recipient_id:PHONE.slice(1),biz_opaque_callback_data:JSON.stringify({broadcastId:ID,claimId:CLAIM})}],
  messages:[{from:PHONE.slice(1),type:"text",text:{body:" STOP "}}]}}]}]};
 const raw=Buffer.from(JSON.stringify(data)),sign=buffer=>"sha256="+crypto.createHmac("sha256",ENV.WHATSAPP_APP_SECRET).update(buffer).digest("hex");
 const request={method:"POST",url:"https://example.test/api/whatsapp-webhook",raw,signature:sign(raw)};
 assert.equal((await webhook({...request,signature:"sha256="+"0".repeat(64)})).status,403);assert.equal(stored.length,0);
 assert.equal((await webhook({...request,raw:Buffer.concat([raw,Buffer.from(" ")])})).status,403);
 assert.equal((await webhook(request)).status,200);assert.equal(stored[0].p_sender_id,ENV.WHATSAPP_PHONE_NUMBER_ID);
 assert.equal(stored[0].p_events[0].status,"delivered");assert.equal(stored[0].p_events[0].claim_id,CLAIM);
 assert.equal(stored[0].p_events[1].kind,"optout");assert.equal(stored[0].p_events[1].phone,PHONE);
 const ignored=structuredClone(data);ignored.entry[0].id="other-account";
 const ignoredRaw=Buffer.from(JSON.stringify(ignored));await webhook({...request,raw:ignoredRaw,signature:sign(ignoredRaw)});assert.equal(stored.length,1);
 const broken=createWhatsAppWebhook({env:ENV,fetchImpl:async()=>reply({},503)});assert.equal((await broken(request)).status,503,"Ask Meta to retry a failed delivery update");
 assert.equal((await webhook({...request,raw:Buffer.alloc(1048577)})).status,413);
 const {createHandler,config}=await import(pathToFileURL(path.join(__dirname,"netlify/functions/whatsapp-webhook.mjs")).href);
 assert.equal(config.path,"/api/whatsapp-webhook");
 const hosted=createHandler(webhook);
 assert.equal(await (await hosted(new Request(handshake))).text(),"123456");
 assert.equal((await hosted(new Request(request.url,{method:"POST",body:raw,headers:{"X-Hub-Signature-256":sign(raw)}}))).status,200);
 console.log("PASS: raw-body HMAC signatures, verification handshake, sender/account binding, delivery callbacks, STOP events and retryable database failures on Netlify");
 const {createAppServer}=require("./serve.cjs");
 const localFixture=fixture();
 const server=createAppServer({sms:localFixture.service,whatsappWebhook:webhook,dashboard:{get:async()=>({sources:{}})}});
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 try {
  const origin="http://127.0.0.1:"+server.address().port;
  const submission=await fetch(origin+"/api/broadcast-sms",{method:"POST",headers:{Authorization:AUTH,"Content-Type":"application/json"},body:JSON.stringify({broadcastId:ID,expectedMode:"whatsapp-cloud"})});
  assert.equal(submission.status,200);assert.equal((await submission.json()).accepted,1);
  const delivery=await fetch(origin+"/api/broadcast-sms?broadcastId="+ID,{headers:{Authorization:AUTH}});
  assert.equal((await delivery.json()).delivery.accepted,1);
  const callback=await fetch(origin+"/api/whatsapp-webhook",{method:"POST",headers:{"X-Hub-Signature-256":sign(raw)},body:raw});
  assert.equal(callback.status,200);
  const verify=await fetch(origin+new URL(handshake).pathname+new URL(handshake).search);assert.equal(await verify.text(),"123456");
 } finally {await new Promise(resolve=>server.close(resolve));}
 console.log("PASS: local Node HTTP submission, delivery summary, byte-preserving webhook and verification routes");
 const commands=deploymentCommands({...ENV,AT_API_KEY:"DO_NOT_UPLOAD"});
 assert.ok(commands.some(c=>c.args.includes("WHATSAPP_ACCESS_TOKEN")));
 assert.ok(commands.some(c=>c.args.includes("SUPABASE_SERVICE_ROLE_KEY")));
 assert.ok(commands.filter(c=>c.args[0]==="env:set").every(c=>c.quiet&&c.args.includes("functions")));
 assert.ok(!commands.some(c=>c.args.includes("DO_NOT_UPLOAD")));
 assert.equal(whatsappSettings(ENV).problem,undefined);
 const staged=deploymentCommands({SMS_PROVIDER:"whatsapp",WHATSAPP_SELF_NUMBER:PHONE,WHATSAPP_VERIFY_TOKEN:ENV.WHATSAPP_VERIFY_TOKEN});
 assert.ok(staged.some(c=>c.args.includes("WHATSAPP_VERIFY_TOKEN")&&c.quiet&&c.args.includes("functions")));
 assert.ok(!staged.some(c=>c.args.includes("whatsapp-cloud")),"Initial webhook verification leaves manual delivery mode unchanged");
 console.log("PASS: direct-delivery deployment includes only selected server settings; API and webhook secrets stay outside browser assets");
 console.log("All WhatsApp Cloud tests passed. No external messages or account changes were made.");
})().catch(error=>{console.error(error);process.exitCode=1;});
