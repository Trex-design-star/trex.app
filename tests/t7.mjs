import crypto from "node:crypto";
process.env.GMAIL_USER="t@gmail.com";process.env.GMAIL_APP_PASSWORD="abcd efgh ijkl mnop";process.env.ADMIN_EMAILS="admin@x.com";process.env.PAYSTACK_SECRET_KEY="sk_test_x";
import nm from "nodemailer";import h from "./api.mjs";
const CODE=()=>/(\d{6})/.exec(nm.__sent.at(-1).text)[1];
let n=0,bad=0;const ok=(c,l)=>{n++;if(!c){bad++;console.log("FAIL",l)}};
const transfers=[];let failNext=false;
globalThis.fetch=async(u,o={})=>{const b=o.body?JSON.parse(o.body):{};const J=(x,s=200)=>new Response(JSON.stringify(x),{status:s});
 if(u.includes("er-api"))return J({result:"success",rates:{NGN:1500,USD:1,GBP:0.8,EUR:0.9}});
 if(u.includes("/balance"))return J({status:true,data:[{currency:"NGN",balance:100000}]});
 if(u.includes("/bank/resolve"))return J({status:true,data:{account_name:"ZED OKAFOR"}});
 if(u.includes("/transferrecipient"))return J({status:true,data:{recipient_code:"RCP_"+b.account_number,details:{bank_name:"GTBank"}}});
 if(u.endsWith("/customer")){if(!b.phone)return J({status:false,message:"phone required"},400);return J({status:true,data:{customer_code:"CUS_1"}})}
 if(u.endsWith("/dedicated_account")){if(b.preferred_bank==="access-bank"&&globalThis.__noAccess)return J({status:false,message:"Bank not supported"},400);globalThis.__usedBank=b.preferred_bank;return J({status:true,data:{account_number:"9900112233",account_name:"TREX/ZED",bank:{name:b.preferred_bank}}})}
 if(u.endsWith("/transfer")){if(failNext){failNext=false;return J({status:false,message:"Insufficient balance"},400)}transfers.push(b);return J({status:true,data:{reference:b.reference}})}
 return J({status:false})};
const call=async(m,p,b,tok,hdr={})=>{const r=await h(new Request("http://x/api"+p,{method:m,headers:{"content-type":"application/json",...(tok?{authorization:"Bearer "+tok}:{}),...hdr},body:b?JSON.stringify(b):undefined}));const j=await r.json().catch(()=>({}));j._h=r.headers;j._s=r.status;return j};
const PW="Passw0rd1";
const reg=async(e,name,cc="NG")=>{await call("POST","/signup",{email:e,password:PW,name,country:cc});await call("POST","/verify",{email:e,code:CODE()});return (await call("POST","/login",{email:e,password:PW})).token};
const face=(tok,seed,extra={})=>call("POST","/liveness",{frames:["data:image/jpeg;base64,/9j/AAAA","data:image/jpeg;base64,/9j/AAAA","data:image/jpeg;base64,/9j/AAAA"],motion:9,challenges:["left"],desc:Array.from({length:128},(_,i)=>Math.sin(seed*7+i)),...extra},tok);
// ---- sign-up / verification / password login ----
ok((await call("POST","/signup",{email:"bad",password:PW,name:"A B",country:"NG"})).error,"bad email");
ok((await call("POST","/signup",{email:"a@x.com",password:"short1",name:"A B",country:"NG"})).error?.includes("8 characters"),"weak password");
ok((await call("POST","/signup",{email:"a@x.com",password:"onlyletters",name:"A B",country:"NG"})).error?.includes("number"),"needs a number");
let r=await call("POST","/signup",{email:"v@x.com",password:PW,name:"Zed Okafor",country:"NG"});ok(r.ok&&r.sent&&!r.demo_code&&!r.token,"signup sends code, no token, no demo code");
ok((await call("POST","/login",{email:"v@x.com",password:PW})).unverified===true,"cannot log in before verifying");
ok((await call("POST","/verify",{email:"v@x.com",code:"000000"})).error,"wrong code");
ok((await call("POST","/verify",{email:"v@x.com",code:CODE()})).ok,"email verified");
ok((await call("POST","/signup",{email:"v@x.com",password:PW,name:"Zed",country:"NG"})).exists===true,"duplicate signup blocked");
let l=await call("POST","/login",{email:"v@x.com",password:PW});ok(l.ok&&l.token&&l.me.name==="Zed Okafor"&&l.engine==="built-in"&&/HttpOnly/.test(l._h.get("set-cookie")),"password login + cookie");
const V=l.token;
ok((await call("POST","/login",{email:"v@x.com",password:"Wrong-pass1"})).error==="Incorrect email or password.","wrong password generic error");
ok((await call("POST","/login",{email:"ghost@x.com",password:PW})).error==="Incorrect email or password.","unknown email same error");
for(let i=0;i<6;i++)await call("POST","/login",{email:"lock@x.com",password:"x"});
await call("POST","/signup",{email:"lock@x.com",password:PW,name:"Lock Me",country:"NG"});await call("POST","/verify",{email:"lock@x.com",code:CODE()});
for(let i=0;i<6;i++)await call("POST","/login",{email:"lock@x.com",password:"bad"+i});ok((await call("POST","/login",{email:"lock@x.com",password:PW})).error?.includes("Too many"),"lockout after repeated failures");
ok((await call("GET","/me","",V)).me.email==="v@x.com","/me works");
ok((await call("GET","/me","", "",{cookie:"trex_session="+encodeURIComponent(V)})).me?.email==="v@x.com","cookie works for address-bar GET");
ok((await call("GET","/me","", "forged.token")).error,"forged token rejected");
// ---- admin check from the address bar ----
const A=await reg("admin@x.com","Admin One");ok(A,"admin account");
let ac=await call("GET","/authcheck","","",{cookie:"trex_session="+encodeURIComponent(A)});ok(ac.steps&&ac.steps[0].ok&&ac.steps.some(s=>s.step==="Paystack key works"&&s.ok),"authcheck works via browser cookie (the reported bug)");
ok((await call("GET","/authcheck","",V)).error==="Admin access only.","non-admin refused");
ok((await call("GET","/authcheck")).error==="Please sign in first.","anonymous refused");
// ---- reset ----
await new Promise(r=>setTimeout(r,0));
ok((await call("POST","/reset/request",{email:"ghost@x.com"})).ok,"reset never reveals unknown emails");
ok((await call("POST","/reset/request",{email:"v@x.com"})).ok,"reset code sent");
ok((await call("POST","/reset/confirm",{email:"v@x.com",code:CODE(),password:"weak"})).error,"reset enforces policy");
ok((await call("POST","/reset/confirm",{email:"v@x.com",code:CODE(),password:"NewPassw0rd2"})).ok,"password reset");
ok(!(await call("GET","/me","",V)).ok,"old sessions die after reset");
ok(!(await call("POST","/login",{email:"v@x.com",password:PW})).ok,"old password rejected");
const V2=(await call("POST","/login",{email:"v@x.com",password:"NewPassw0rd2"})).token;ok(V2,"new password works");
// ---- gates: face check, vendor ----
const C=await reg("c@x.com","Ada Obi");
ok((await call("POST","/vendor/enable",{accept:true,phone:"+2348031234567"},V2)).need_live,"vendor needs face check first");
ok((await face(V2,1,{motion:1})).error?.includes("move"),"static photo rejected");
ok((await face(V2,1)).status==="verified","face verified (model descriptor)");
ok((await face(C,1)).duplicate===true,"same face on a 2nd account is BLOCKED");
ok((await face(C,2)).status==="verified","different face passes");
ok((await call("GET","/liveness/flags","",A)).flags.length===1,"admin sees duplicate attempt");
ok((await call("POST","/offers",{provide:"USD",want:"NGN",rate:1500,min:10,max:100},V2)).need_vendor,"offers are vendor-only");
ok((await call("GET","/bond/me","",V2)).vendor===false,"not a vendor yet");
ok((await call("POST","/vendor/enable",{accept:true,phone:"bad"},V2)).error?.includes("phone"),"phone required");
ok((await call("POST","/vendor/enable",{accept:true,phone:"+2348031234567"},V2)).ok,"vendor enabled");
const G=await reg("gh@x.com","Kofi M","GH");await face(G,3);
ok((await call("POST","/vendor/enable",{accept:true,phone:"+233201234567"},G)).error?.includes("Nigeria"),"non-NG vendor gated");
// ---- profile ----
ok((await call("POST","/profile",{display:"Zed FX",bio:"Fast USD",pledge:"~5 minutes",langs:"English, Yoruba",avatar:"data:image/jpeg;base64,/9j/AAAA"},V2)).ok,"profile saved to database");
const pj=await call("GET","/profile","",V2);ok(pj.profile.display==="Zed FX"&&pj.profile.avatar&&pj.profile.bio==="Fast USD","profile reads back");
ok((await h(new Request("http://x/api/avatar/"+pj.profile.uid))).status===200,"public avatar image served");
ok((await call("POST","/profile",{display:"x"},V2)).error,"display name validated");
// ---- offers ----
await call("POST","/bond/account",{account_number:"0123456789",bank_code:"058"},V2);
const of=(await call("POST","/offers",{provide:"USD",want:"NGN",rate:1500,min:10,max:100,pay_details:"GTBank 0123456789 Zed Okafor",vendor:"FAKE Name • ★5 • 999 trades"},V2)).offer;ok(of&&of.id,"vendor publishes offer");
let ol=(await call("GET","/offers","",C)).offers;ok(ol.length===1&&ol[0].vendor==="Zed FX • ★new • 0 trades"&&ol[0].photo&&!("owner" in ol[0]),"offers show real vendor profile, no fake stats, no owner leak");
ok((await call("GET","/offers?mine=1","",C)).offers.length===0,"customer has no own offers");
ok((await call("GET","/offers")).error,"offers need sign-in");
ok((await call("POST","/offers",{provide:"USD",want:"NGN",rate:1500,min:10,max:100},V2)).error?.includes("payment details"),"offer needs payment details");
ok(!JSON.stringify((await call("GET","/offers","",C)).offers).includes("0123456789"),"payment details never leak in public offers");
// ---- trade, deposit, auto-start ----
const open=(amt,tok=C)=>call("POST","/trades",{offer_id:of.id,sell:"NGN",recv:"USD",amount:amt,receive_details:"PayPal ada@example.com"},tok);
ok((await open(500)).error?.includes("maximum"),"max enforced");
let t=await open(50);ok(t.ok&&t.trade.state==="awaiting_vendor"&&t.trade.bond_ngn===37500&&!t.trade.customer_email,"trade opens awaiting vendor, bond = 50% of live value");
const id=t.trade.id,act=(a,x,tok)=>call("POST","/trade_action",{id,action:a,...x},tok);
ok(!(await act("pay",{proof:"p"},C)).ok,"cannot pay early");ok(!(await act("accept",{},C)).ok,"customer cannot accept");
ok((await call("GET","/notifications","",V2)).items.some(x=>x.title==="New trade request"),"vendor notified of request");
ok(!("pay_details" in (await call("GET","/trades","",C)).trades[0]),"customer cannot see bank details before acceptance");
ok((await act("accept",{},V2)).trade.state==="awaiting_bond","accept w/o funds -> awaiting bond");
ok((await call("POST","/bond/deposit",{},V2)).dva.account_number==="9900112233"&&globalThis.__usedBank==="access-bank","deposit account uses PAYSTACK_BANK=access-bank by default");
const hook=async ev=>{const raw=JSON.stringify(ev);const s=crypto.createHmac("sha512","sk_test_x").update(raw).digest("hex");return (await h(new Request("http://x/api/paystack/webhook",{method:"POST",headers:{"x-paystack-signature":s},body:raw}))).status};
ok(await hook({event:"charge.success",data:{reference:"R1",channel:"dedicated_nuban",currency:"NGN",amount:5000000,customer:{email:"v@x.com"}}})===200,"live deposit webhook");
await hook({event:"charge.success",data:{reference:"R1",channel:"dedicated_nuban",currency:"NGN",amount:5000000,customer:{email:"v@x.com"}}});
let wl=await call("GET","/wallet","",V2);ok(wl.ngn.locked===37500&&wl.ngn.available===12500,"real balances: locked 37,500 / free 12,500 (no double credit)");
ok((await call("GET","/notifications","",C)).items.some(x=>x.title==="Ready for your payment"),"customer told to pay");
ok((await call("GET","/trades","",C)).trades[0].pay_details==="GTBank 0123456789 Zed Okafor","customer sees vendor bank details after acceptance");ok((await call("GET","/trades","",V2)).trades[0].receive_details==="PayPal ada@example.com","vendor sees where to send currency");
ok((await act("pay",{proof:"r.png"},C)).ok&&(await act("confirm",{},V2)).ok,"pay + confirm");
ok(!(await act("deliver",{},V2)).ok,"delivery needs proof");ok((await act("deliver",{proof:"d"},V2)).ok&&(await act("complete",{},C)).ok,"deliver + complete");
const fee=37500*2*0.015;ok(transfers.length===1&&transfers[0].amount===Math.round((37500-fee)*100),"bond returned immediately minus 1.5% fee: "+transfers[0]?.amount);
ok((await call("GET","/ledger","",A)).ledger.some(e=>e.kind==="fee"&&e.amount===1125),"fee recorded separately");
// ---- wallet shows only traded currencies; zero for new users ----
wl=await call("GET","/wallet","",C);ok(wl.currencies.length===2&&wl.currencies.every(c=>["USD","NGN"].includes(c.code))&&wl.currencies.find(c=>c.code==="USD").received===50,"customer wallet: only traded currencies, real totals");
const N=await reg("new@x.com","New Person");wl=await call("GET","/wallet","",N);ok(wl.currencies.length===0&&wl.ngn.available===0&&wl.ngn.locked===0,"new account = zero, no currencies");
ok((await call("POST","/profile",{hide_balances:true},C)).ok&&(await call("GET","/wallet","",C)).hide===true,"hide-balances saved in database");
// ---- rating + vendor reputation ----
ok((await call("POST","/ratings",{trade:id,rating:5},C)).ok&&(await call("POST","/ratings",{trade:id,rating:5},C)).error,"rate once");
ol=(await call("GET","/offers","",C)).offers;ok(ol[0].vendor==="Zed FX • ★5 • 1 trades","real reputation computed");
// ---- notifications ----
let nt=await call("GET","/notifications","",C);ok(nt.unread>0&&nt.items.length>3,"notifications list");
await call("POST","/notifications",{all:true},C);ok((await call("GET","/notifications","",C)).unread===0,"mark all read");
// ---- chat ----
ok((await call("POST","/chat",{trade:id,text:"hello"},C)).ok,"chat send");
ok((await call("POST","/chat",{trade:id,text:"call 08031234567"},V2)).held,"contact blocked");
ok((await call("POST","/chat",{trade:id,typing:true},V2)).ok&&(await call("GET","/chat?trade="+id,"",C)).other_typing===true,"typing indicator");
let cg=await call("GET","/chat?trade="+id,"",C);ok(cg.other.name==="Zed FX"&&cg.other.avatar,"chat shows other party profile");
ok((await call("GET","/chat?trade="+id,"",N)).error?.includes("private"),"stranger blocked");
ok((await call("GET","/notifications","",V2)).items.some(x=>x.type==="chat"),"chat notification");
// ---- dispute, forfeiture, compensation ----
await call("POST","/hook",{});await hook({event:"charge.success",data:{reference:"R3",channel:"dedicated_nuban",currency:"NGN",amount:5000000,customer:{email:"v@x.com"}}});
t=await open(20);const id2=t.trade.id;await call("POST","/trade_action",{id:id2,action:"accept"},V2);await call("POST","/trade_action",{id:id2,action:"pay",proof:"p"},C);
ok((await call("POST","/trade_action",{id:id2,action:"dispute"},C)).ok,"dispute");
ok((await call("GET","/chat?trade="+id2,"",A)).ok,"admin reads disputed chat");
const d=(await call("GET","/disputes","",A)).disputes[0];
ok((await call("POST","/resolve",{id:d.id,how:"VENDOR-AT-FAULT"},V2)).error==="Admin access only.","non-admin can't resolve");
ok((await call("POST","/resolve",{id:d.id,how:"VENDOR-AT-FAULT"},A)).ok,"admin resolves");
wl=await call("GET","/wallet","",C);ok(wl.ngn.available===15000,"customer compensated 15,000 into balance (no bank saved yet)");
// ---- vendor withdraw / failure / approval ----
failNext=true;let w=await call("POST","/bond/withdraw",{amount:1000},V2);ok(w.status==="failed","failed transfer reported");
ok((await call("GET","/wallet","",V2)).ngn.available>=1000,"credited back after failure");
await hook({event:"charge.success",data:{reference:"R4",channel:"dedicated_nuban",currency:"NGN",amount:90000000,customer:{email:"v@x.com"}}});
w=await call("POST","/bond/withdraw",{amount:600000},V2);ok(w.status==="pending_approval","big withdrawal needs approval");
const pend=(await call("GET","/bond/pending","",A)).payouts;ok(pend.length===1,"pending listed");
ok((await call("POST","/bond/approve",{ref:pend[0].ref},V2)).error==="Admin access only.","vendor can't approve");
ok((await call("POST","/bond/approve",{ref:pend[0].ref},A)).status==="pending","admin approval sends");
// ---- admin ----
const ov=await call("GET","/admin/overview","",A);ok(ov.users>=5&&ov.vendors===1&&ov.volume.NGN>0,"admin overview from real data");
ok((await call("GET","/admin/vendors","",A)).vendors[0].completed===1,"admin vendor list");
ok((await call("POST","/admin/vendor",{email:"v@x.com",action:"suspend"},A)).ok&&!(await call("GET","/me","",V2)).ok,"suspension logs the vendor out");
ok((await call("POST","/admin/vendor",{email:"v@x.com",action:"unsuspend"},A)).ok,"unsuspend");
ok((await call("POST","/tickets",{cat:"Payments",title:"Help"},C)).ok&&(await call("GET","/tickets","",C)).tickets.length===1&&(await call("GET","/tickets?all=1","",A)).tickets.length===1,"support tickets");
ok((await call("GET","/health")).email==="gmail","health reports email");
console.log(n+" checks, "+bad+" failed");
