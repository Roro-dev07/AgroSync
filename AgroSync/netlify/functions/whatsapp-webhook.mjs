import cloud from "../../whatsapp-cloud.cjs";
const webhook=cloud.createWhatsAppWebhook();
export function createHandler(handler=webhook) {
 return async request=>{
  try {
   const size=Number(request.headers.get("content-length")||0);
   if(size>cloud.MAX_WEBHOOK_BYTES)return new Response("Webhook request too large.",{status:413});
   const raw=Buffer.from(await request.arrayBuffer());
   const result=await handler({method:request.method,url:request.url,raw,signature:request.headers.get("x-hub-signature-256")});
   return new Response(result.text,{status:result.status,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
  }catch{return new Response("Webhook temporarily unavailable.",{status:503});}
 };
}
export default createHandler();
export const config={path:"/api/whatsapp-webhook"};
