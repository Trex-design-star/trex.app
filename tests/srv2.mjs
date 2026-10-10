import http from "node:http";import fs from "node:fs";import path from "node:path";import crypto from "node:crypto";
process.env.GMAIL_USER="t@gmail.com";process.env.GMAIL_APP_PASSWORD="abcd efgh ijkl mnop";process.env.ADMIN_EMAILS="admin@x.com";process.env.PAYSTACK_SECRET_KEY="sk_test_x";
import nm from "nodemailer";
const transfers=[];
globalThis.fetch=async(u,o={})=>{const b=o.body?JSON.parse(o.body):{};const J=(x)=>new Response(JSON.stringify(x));
 if(String(u).includes("er-api"))return J({result:"success",rates:{NGN:1500,USD:1,GBP:0.8,EUR:0.9,KES:129,GHS:15.5}});
 if(u.includes("/balance"))return J({status:true,data:[{currency:"NGN",balance:100000}]});
 if(u.includes("/bank?"))return J({status:true,data:[{name:"GTBank",code:"058"}]});
 if(u.includes("/bank/resolve"))return J({status:true,data:{account_name:"ZED OKAFOR"}});
 if(u.includes("/transferrecipient"))return J({status:true,data:{recipient_code:"RCP_1",details:{bank_name:"GTBank"}}});
 if(u.endsWith("/customer"))return J({status:true,data:{customer_code:"CUS_1"}});
 if(u.endsWith("/dedicated_account"))return J({status:true,data:{account_number:"9900112233",account_name:"TREX/ZED",bank:{name:b.preferred_bank}}});
 if(u.endsWith("/transfer")){transfers.push(b);return J({status:true,data:{reference:b.reference}})}
 return J({status:false})};
import h from "./api.mjs";
const R="/mnt/user-data/outputs/site",T={".html":"text/html",".js":"text/javascript",".css":"text/css"};
http.createServer(async(q,s)=>{
 if(q.url.startsWith("/__code")){const e=new URL("http://x"+q.url).searchParams.get("email");const m=[...nm.__sent].reverse().find(x=>x.to===e);s.writeHead(200);return s.end(m?/(\d{6})/.exec(m.text)[1]:"")}
 if(q.url==="/__transfers"){s.writeHead(200);return s.end(JSON.stringify(transfers))}
 if(q.url.startsWith("/__hook")){const ev=decodeURIComponent(q.url.split("?")[1]);const raw=ev;const sig=crypto.createHmac("sha512","sk_test_x").update(raw).digest("hex");const r=await h(new Request("http://x/api/paystack/webhook",{method:"POST",headers:{"x-paystack-signature":sig},body:raw}));s.writeHead(r.status);return s.end("ok")}
 if(q.url.startsWith("/api")){const b=await new Promise(r=>{let d=[];q.on("data",c=>d.push(c));q.on("end",()=>r(Buffer.concat(d)))});
  const res=await h(new Request("http://x"+q.url,{method:q.method,headers:q.headers,body:["GET","HEAD"].includes(q.method)?undefined:b}));
  const hd={};res.headers.forEach((v,k)=>{hd[k]=v});s.writeHead(res.status,hd);return s.end(Buffer.from(await res.arrayBuffer()));}
 let p=path.join(R,q.url.split("?")[0]==="/"?"index.html":q.url.split("?")[0]);
 if(!fs.existsSync(p)||fs.statSync(p).isDirectory()){s.writeHead(404);return s.end("nf")}
 s.writeHead(200,{"Content-Type":T[path.extname(p)]||"text/plain"});s.end(fs.readFileSync(p));
}).listen(8099);
