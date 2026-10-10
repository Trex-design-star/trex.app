process.env.GMAIL_USER="t@gmail.com";process.env.GMAIL_APP_PASSWORD="abcd efgh ijkl mnop";process.env.ADMIN_EMAILS="admin@x.com";process.env.DATABASE_URL="postgres://fake";process.env.PAYSTACK_SECRET_KEY="";
import nm from "nodemailer";import h from "./api.mjs";import pgm from "pg";
const CODE=()=>/(\d{6})/.exec(nm.__sent.at(-1).text)[1];
let n=0,bad=0;const ok=(c,l)=>{n++;if(!c){bad++;console.log("FAIL",l)}};
const call=async(m,p,b,tok,hdr={})=>{const r=await h(new Request("http://x/api"+p,{method:m,headers:{"content-type":"application/json",...(tok?{authorization:"Bearer "+tok}:{}),...hdr},body:b?JSON.stringify(b):undefined}));return r.json()};
const PW="Passw0rd1";
const reg=async(e,pw=PW)=>{await call("POST","/signup",{email:e,password:pw,name:"Test User",country:"NG"});await call("POST","/verify",{email:e,code:CODE()});return call("POST","/login",{email:e,password:pw})};
let hl=await call("GET","/health");ok(hl.database==="postgres"&&hl.auth==="better-auth","engines: "+JSON.stringify(hl));
for(const mode of ["both","body","header"]){globalThis.__BA_MODE=mode;const r=await reg("m"+mode+"@x.com");ok(r.ok&&r.engine==="better-auth"&&!r.token.includes("."),"Better Auth password login ("+mode+")");
  ok((await call("GET","/me","",r.token)).me.email==="m"+mode+"@x.com","session validated from Postgres ("+mode+")");ok((await call("GET","/me","",r.token+".c2ln%3D")).ok,"signed form accepted ("+mode+")");}
globalThis.__BA_MODE="both";
ok(globalThis.__baUsers.has("mboth@x.com")&&globalThis.__accts.has("mboth@x.com"),"SYNC: signup created the Better Auth user + credential row in Postgres");
ok(!(await call("POST","/login",{email:"mboth@x.com",password:"Wrong-pass1"})).ok,"wrong password rejected by Better Auth path");
let r=await reg("out@x.com");await call("POST","/signout","",r.token);ok(!(await call("GET","/me","",r.token)).ok,"sign-out revokes Better Auth session");
// reset must kill the old Better Auth password
r=await reg("rs@x.com");await call("POST","/reset/request",{email:"rs@x.com"});await call("POST","/reset/confirm",{email:"rs@x.com",code:CODE(),password:"Brand-New9pass"});
ok(!(await call("POST","/login",{email:"rs@x.com",password:PW})).ok,"old password dead after reset");
const nl=await call("POST","/login",{email:"rs@x.com",password:"Brand-New9pass"});ok(nl.ok&&nl.engine==="built-in","new password works (built-in after reset)");
ok(!(await call("GET","/me","",r.token)).ok,"old Better Auth session revoked by reset");
globalThis.__BA_MODE="orphan";r=await reg("orph@x.com");ok(r.ok&&r.engine==="built-in","unvalidatable BA session -> built-in fallback");
globalThis.__BA_MODE="throw";r=await reg("thr@x.com");ok(r.ok&&r.engine==="built-in","BA errors -> built-in fallback, nobody locked out");
globalThis.__BA_MODE="both";
const A=(await reg("admin@x.com")).token;
let ac=await call("GET","/authcheck","","",{cookie:"trex_session="+encodeURIComponent(A)});ok(ac.steps.some(s=>/writes user \+ password/.test(s.step)&&s.ok)&&ac.steps.every(s=>s.ok||/Paystack/.test(s.step)),"authcheck incl. Postgres sync passes: "+JSON.stringify(ac.steps.filter(x=>!x.ok)));
globalThis.__BA_MODE="throw";ac=await call("GET","/authcheck","",A);ok(!ac.ok&&ac.steps.some(x=>!x.ok&&x.note),"authcheck reports exact failing step");
ok(pgm.__store.size>5,"app data lives in postgres kv");
console.log(n+" checks, "+bad+" failed");
