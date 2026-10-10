import json,urllib.request,urllib.parse,hmac,hashlib
from playwright.sync_api import sync_playwright
B="http://localhost:8099/";errs=[];n=0;bad=0
def chk(l,c):
    global n,bad;n+=1
    if not c:bad+=1;print("FAIL",l)
def code(e):return urllib.request.urlopen(B+"__code?email="+urllib.parse.quote(e)).read().decode()
def hook(ev):urllib.request.urlopen(B+"__hook?"+urllib.parse.quote(json.dumps(ev)))
def transfers():return json.loads(urllib.request.urlopen(B+"__transfers").read())
PW="Passw0rd1"
def signup(pg,email,name,face):
    pg.goto(B+"onboarding.html");pg.select_option("#country","NG");pg.click("#s1go")
    pg.fill("#name",name);pg.fill("#email",email);pg.fill("#pw",PW);pg.fill("#pw2",PW);pg.click("#s2go");pg.wait_for_selector("#s3:not(.hidden)")
    pg.wait_for_timeout(300);c=code(email)
    for i,ch in enumerate(c):pg.locator("#otp input").nth(i).fill(ch)
    pg.click("#s3go");pg.wait_for_selector("#s4:not(.hidden)",timeout=8000)
    pg.click("#liveStart")
    if face.endswith(".png"):
        pg.wait_for_selector("#liveFile",state="attached",timeout=8000);pg.set_input_files("#liveFile",face)
    pg.wait_for_function("(()=>{var t=document.getElementById('liveMsg').textContent;return t.includes('received')||t.includes('complete')||t.includes('already belongs')})()",timeout=60000)
    return pg.inner_text("#liveMsg")
def api(pg,method,path,body=None):
    return pg.evaluate("async([m,p,b])=>{const r=await fetch('/api'+p,{method:m,headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('trex_session')},body:b?JSON.stringify(b):undefined});return r.json()}",[method,path,body])
with sync_playwright() as p:
    br=p.chromium.launch(executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args=["--no-sandbox","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"])
    cam=lambda:br.new_context(permissions=["camera"])
    def nocam():
        c=br.new_context(permissions=[]);c.add_init_script("navigator.mediaDevices.getUserMedia=function(){return Promise.reject(new Error('denied'))}");return c
    A,V,C,D,N=cam().new_page(),nocam().new_page(),nocam().new_page(),cam().new_page(),nocam().new_page()
    for pg in (A,V,C,D,N):
        pg.on("pageerror",lambda e:errs.append(str(e)));pg.on("dialog",lambda d:d.accept("rcpt-77"))
    # --- public / private pages ---
    A.goto(B+"index.html");A.wait_for_timeout(800);chk("landing is public + has Sign in",A.is_visible("a[href='signin.html']"))
    chk("no fake landing figures",not any(t in A.content() for t in ["312 trades","Adaobi","328.95","97%","≤45"]))
    A.goto(B+"dashboard.html");A.wait_for_url("**/signin.html*",timeout=5000);chk("private pages redirect to sign-in",True)
    # --- sign up (password + email code + face) ---
    m=signup(A,"admin@x.com","Admin One","camera");chk("admin signup + face (camera)","received" in m or "complete" in m)
    m=signup(V,"vendor@x.com","Zed Okafor","/tmp/t/selfie.png");chk("vendor signup + selfie face",("received" in m or "complete" in m))
    m=signup(C,"cust@x.com","Ada Obi","/tmp/t/selfie2.png");chk("customer signup + different selfie","received" in m or "complete" in m)
    D.goto(B+"onboarding.html");D.select_option("#country","NG");D.click("#s1go");D.fill("#name","Copy Cat");D.fill("#email","dup@x.com");D.fill("#pw",PW);D.fill("#pw2",PW);D.click("#s2go");D.wait_for_selector("#s3:not(.hidden)");D.wait_for_timeout(300)
    for i,ch in enumerate(code("dup@x.com")):D.locator("#otp input").nth(i).fill(ch)
    D.click("#s3go");D.wait_for_selector("#s4:not(.hidden)");D.click("#liveStart");D.wait_for_function("document.getElementById('liveMsg').textContent.includes('already belongs')",timeout=60000)
    chk("same face on another account is blocked",True)
    for e in ("vendor@x.com","cust@x.com"):chk("admin approves "+e,api(A,"POST","/liveness/clear",{"email":e}).get("ok"))
    # --- sign out / password sign-in ---
    V.goto(B+"settings.html");V.wait_for_timeout(800);V.click("text=Security");V.click("#out1");V.wait_for_url("**/signin.html*")
    V.fill("#email","vendor@x.com");V.fill("#pw","wrong-pass1");V.click("#go");V.wait_for_timeout(800);chk("wrong password shows error","Incorrect" in V.inner_text("#err"))
    V.fill("#pw",PW);V.click("#go");V.wait_for_url("**/dashboard.html",timeout=8000);chk("password-only sign-in works",True)
    # --- vendor-only pages ---
    C.goto(B+"offers.html");C.wait_for_url("**/vendor.html",timeout=6000);chk("customer cannot open Offers",True)
    C.goto(B+"bond.html");C.wait_for_url("**/vendor.html",timeout=6000);chk("customer cannot open Protection",True)
    C.goto(B+"admin.html");C.wait_for_url("**/dashboard.html",timeout=6000);chk("customer cannot open Operations",True)
    C.goto(B+"more.html");C.wait_for_timeout(800);t=C.inner_text("#menu");chk("More: no Landing/Sign in/Create/Growth/Launch/Operations",not any(x in t for x in ["Landing","Create account","Growth","Launch","Operations","Brand"]) and "Become a vendor" in t)
    # --- become vendor ---
    V.goto(B+"vendor.html");V.click("#becomeBtn");V.fill("#vph","+2348031234567");V.check("#vacc");V.click("#vgo");V.wait_for_url("**/offers.html",timeout=8000);chk("vendor activated",True)
    V.wait_for_timeout(800);V.fill("#pname","Zed FX");V.fill("#pbio","Fast USD");V.click("#saveProfile");V.wait_for_timeout(600)
    V.fill("#rate","1500");V.fill("#min","10");V.fill("#max","200");V.fill("#payd","GTBank 0123456789 Zed Okafor");V.click("#save");V.wait_for_timeout(900);chk("offer published",V.inner_text("#oErr").startswith("Offer saved"))
    V.goto(B+"bond.html");V.wait_for_timeout(800);V.select_option("#payBank","058");V.fill("#payNo","0123456789");V.click("#paySave");V.wait_for_timeout(800);chk("payout account saved","ZED OKAFOR" in V.inner_text("#payLog"))
    V.click("#topBtn");V.wait_for_timeout(800);dep=V.inner_text("#inLog");chk("deposit account shown (access-bank requested)","9900112233" in dep and "access-bank" in dep)
    # --- new account shows zero + hidden balance ---
    C.goto(B+"dashboard.html");C.wait_for_timeout(1500);chk("new customer: no currencies, no fake figures","Nothing yet" in C.inner_text("#curRow"))
    # --- customer requests trade ---
    C.goto(B+"trade.html?send=NGN&recv=USD");C.wait_for_timeout(1500)
    chk("vendor offer visible with real profile","Zed FX" in C.inner_text("#offers"))
    C.click("text=Trade with this vendor");C.fill("#rPay","30000");C.fill("#rDetails","PayPal ada@example.com");C.click("#rGo");C.wait_for_timeout(1500)
    chk("customer waits for vendor","Waiting for vendor" in C.inner_text("#tState"))
    tid=C.inner_text("#tTitle")
    # --- vendor accepts, deposits bond ---
    V.goto(B+"vendor-dashboard.html");V.wait_for_timeout(1500);chk("vendor bell shows notification",V.is_visible("#bell i"))
    V.click("button[data-a=accept]");V.wait_for_url("**/bond.html*",timeout=8000);V.wait_for_timeout(1500);chk("vendor sent to deposit page with amount","waiting for your bond" in V.inner_text("#tradeNeed"))
    hook({"event":"charge.success","data":{"reference":"R1","channel":"dedicated_nuban","currency":"NGN","amount":5000000,"customer":{"email":"vendor@x.com"}}})
    V.wait_for_function("document.getElementById('tradeNeed').textContent.includes('Bond received')",timeout=15000);chk("bond arrival starts trade",True)
    C.wait_for_function("document.getElementById('tState').textContent.includes('send your payment')",timeout=12000);chk("customer told to pay",True)
    chk("customer sees vendor bank details",C.is_visible("#tPay") and "0123456789" in C.inner_text("#tPay"))
    # --- chat both ways ---
    C.fill(".wa-i input[type=text]","Hi Zed, paying now");C.press(".wa-i input[type=text]","Enter");C.wait_for_timeout(700)
    C.fill(".wa-i input[type=text]","call me 08031234567");C.press(".wa-i input[type=text]","Enter");C.wait_for_timeout(900);chk("chat holds phone numbers",C.is_visible(".wa-e"))
    V.goto(B+"vendor-dashboard.html?open="+tid);V.wait_for_timeout(3500);chk("vendor sees customer message",any("paying now" in x.inner_text() for x in V.query_selector_all(".wa-m")))
    V.fill("#chatBox .wa-i input[type=text]","Welcome Ada!");V.press("#chatBox .wa-i input[type=text]","Enter");C.wait_for_timeout(4500)
    chk("customer sees reply + read ticks",any("Welcome Ada" in x.inner_text() for x in C.query_selector_all(".wa-m")) and C.is_visible(".wa-t .rd"))
    chk("chat shows vendor name","Zed FX" in C.inner_text(".wa-h"))
    V.click("#chatClose")
    # --- complete the trade ---
    C.fill("#proof","NIP-12345");C.click("#btnPay");C.wait_for_timeout(1200)
    V.goto(B+"vendor-dashboard.html");V.wait_for_timeout(1500);chk("vendor sees where to send currency","ada@example.com" in V.inner_text("#trades"))
    V.click("button[data-a=confirm]");V.wait_for_timeout(1500);V.click("button[data-a=deliver]");V.wait_for_timeout(1500)
    C.wait_for_function("!document.getElementById('btnComplete').classList.contains('hidden')",timeout=12000);C.click("#btnComplete");C.wait_for_timeout(1500)
    chk("trade completed",C.inner_text("#tState")=="Completed")
    tr=transfers();chk("bond returned to bank (minus 1.5% fee)",len(tr)==1 and tr[0]["amount"]==1455000 or print(tr))
    C.select_option("#rating","5");C.click("#submitRating");C.wait_for_timeout(700)
    # --- balances, hide, notifications ---
    C.goto(B+"dashboard.html");C.wait_for_timeout(2000);cur=C.inner_text("#curRow");chk("customer wallet shows only traded currencies (USD, NGN)","USD" in cur and "NGN" in cur and "EUR" not in cur)
    C.click("#eye");C.wait_for_timeout(600);chk("balances hide as asterisks","****" in C.inner_text("#curRow"))
    C.goto(B+"notifications.html");C.wait_for_timeout(1500);chk("notifications list",C.locator(".it").count()>=4)
    V.goto(B+"vendor-dashboard.html");V.wait_for_timeout(1500);chk("vendor bond shows zero locked after trade","₦0" in V.inner_text("#locked") or "No bond locked" in V.inner_text("#locked"))
    # --- profile edit ---
    C.goto(B+"settings.html");C.wait_for_timeout(1000);C.fill("#disp","Ada O.");C.fill("#bio","Hello");C.click("#saveP");C.wait_for_timeout(800);chk("profile saved to database",api(C,"GET","/profile")["profile"]["display"]=="Ada O.")
    # --- admin ---
    A.goto(B+"admin.html");A.wait_for_timeout(1500);chk("admin overview real",("verified users" in A.inner_text("#health")))
    A.click("button[data-t=system]");A.click("#runCheck");A.wait_for_timeout(2500);chk("admin system check runs from the app (the reported bug)","You are signed in as an admin" in A.inner_text("#checkOut") and "Paystack key works" in A.inner_text("#checkOut"))
    A.goto(B+"api/authcheck");A.wait_for_timeout(800);chk("direct /api/authcheck link works after sign-in (cookie)","You are signed in as an admin" in A.inner_text("body"))
    A.goto(B+"design.html");A.wait_for_timeout(800);chk("brand sheet opens for admin",A.is_visible("text=Back to Operations centre"))
    A.goto(B+"more.html");A.wait_for_timeout(800);chk("admin More has Operations + Brand sheet","Brand sheet" in A.inner_text("#menu"))
    for pg,f in ((A,"automation"),(V,"offers"),(V,"bond")):pg.goto(B+f+".html");pg.wait_for_timeout(600)
    br.close()
print(n,"checks,",bad,"failed");print("PAGE ERRORS:",errs)
