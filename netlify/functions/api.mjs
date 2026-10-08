import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

export const config = { path: "/api/*" };

const st = () => getStore({ name: "trex", consistency: "strong" });
let _pg = null, _pgErr = null;
const SCHEMA = `
create table if not exists kv (key text primary key, value jsonb not null);
create table if not exists "user" (id text primary key, name text not null, email text not null unique, "emailVerified" boolean not null, image text, "createdAt" timestamptz not null, "updatedAt" timestamptz not null);
create table if not exists "session" (id text primary key, "expiresAt" timestamptz not null, token text not null unique, "createdAt" timestamptz not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user"(id) on delete cascade);
create table if not exists "account" (id text primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user"(id) on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, scope text, password text, "createdAt" timestamptz not null, "updatedAt" timestamptz not null);
create table if not exists "verification" (id text primary key, identifier text not null, value text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz, "updatedAt" timestamptz);`;
async function pg() {
  if (!process.env.DATABASE_URL) return null;
  if (_pg) return _pg;
  const mod = await import("pg"); const P = mod.default || mod;
  const c = new P.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  c.on("error", () => { _pg = null; });
  await c.connect(); await c.query(SCHEMA); _pg = c; return c;
}
const rd = async (k, d) => {
  const c = await pg();
  if (c) { const r = await c.query("select value from kv where key=$1", [k]); return r.rows.length && r.rows[0].value !== null ? r.rows[0].value : d; }
  return (await st().get(k, { type: "json" })) ?? d;
};
const wr = async (k, v) => {
  const c = await pg();
  if (c) return c.query("insert into kv(key,value) values($1,$2::jsonb) on conflict(key) do update set value=excluded.value", [k, JSON.stringify(v)]);
  return st().setJSON(k, v);
};
const hex = (n) => crypto.randomBytes(n).toString("hex").toUpperCase();
const now = () => new Date().toISOString();
const H = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Idempotency-Key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const out = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: H });
const err = (m, s = 422, x = {}) => out({ ok: false, error: m, ...x }, s);

const SEED = [
  { id: "OFR-1", provide: "USD", want: "NGN", rate: 1520, min: 65, max: 330, vendor: "Adaobi • ★4.8 • 312 trades", country: "NG", tier: "Gold", capacity: 4000, methods: ["Bank transfer"], terms: "Pay within 30 minutes.", live: true, legacy: true },
  { id: "OFR-2", provide: "GBP", want: "NGN", rate: 1940, min: 103, max: 2060, vendor: "Tunde • ★4.9 • 540 trades", country: "NG", tier: "Gold", capacity: 3000, methods: ["Bank transfer"], terms: "Pay within 30 minutes.", live: true, legacy: true },
  { id: "OFR-3", provide: "EUR", want: "NGN", rate: 1650, min: 60, max: 1500, vendor: "New vendor • ★new • 3 trades", country: "NG", tier: "Probation", capacity: 2000, methods: ["Bank transfer"], terms: "Pay within 1 hour.", live: true, legacy: true },
];
const BOND0 = { caps: { USD: 10000, NGN: 8000000, GBP: 4000, EUR: 6000 }, reserved: {} };
const CFG0 = { fee_pct: 1.5, confirm_mins: 30, grace_hours: 24, thresh: 500000, disabled: [], pausedPairs: [] };

const FALL = { USD: 1, NGN: 1520, GBP: 0.7835051546, EUR: 0.9212121212 };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function secret() { let s = await rd("secret", null); if (!s) { s = { v: crypto.randomBytes(32).toString("hex") }; await wr("secret", s); } return s.v; }
async function sign(p) { return crypto.createHmac("sha256", await secret()).update(p).digest("base64url"); }
async function mkToken(em) { const p = b64({ e: em, x: Date.now() + 30 * 864e5 }); return p + "." + (await sign(p)); }
let _ba = null, _baErr = null; const _lastOtp = {};
async function ba() {
  if (_ba !== null) return _ba || null;
  if (!process.env.DATABASE_URL) { _ba = false; return null; }
  try {
    const { betterAuth } = await import("better-auth");
    const { emailOTP, bearer } = await import("better-auth/plugins");
    const mod = await import("pg"); const P = mod.default || mod;
    const pool = new P.Pool({ connectionString: process.env.DATABASE_URL, max: 3, ssl: { rejectUnauthorized: false } });
    _ba = betterAuth({
      database: pool, secret: await secret(), basePath: "/api/auth",
      baseURL: process.env.URL || process.env.SITE_URL || "http://localhost:8888",
      plugins: [bearer(), emailOTP({ otpLength: 6, expiresIn: 600, allowedAttempts: 5,
        async sendVerificationOTP({ email, otp }) { _lastOtp[String(email).toLowerCase()] = otp; } })],
    });
  } catch (e) { _baErr = String((e && e.message) || e).slice(0, 200); _ba = false; }
  return _ba || null;
}
async function authOf(req) {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer /, ""); if (!t) return null;
  const [p, sg] = t.split(".");
  if (p && sg) {
    const good = await sign(p);
    if (sg.length === good.length && crypto.timingSafeEqual(Buffer.from(sg), Buffer.from(good))) {
      try { const o = JSON.parse(Buffer.from(p, "base64url").toString()); return o.x > Date.now() ? String(o.e) : null; } catch { /* fall through */ }
    }
  }
  return sessionEmail(t);
}
async function sessionEmail(t) {
  try {
    const c = await pg(); if (!c) return null;
    const raw = decodeURIComponent(String(t)).split(".")[0]; if (!raw) return null;
    const r = await c.query('select u.email from "session" s join "user" u on u.id = s."userId" where s.token = $1 and s."expiresAt" > now()', [raw]);
    return r.rows.length ? String(r.rows[0].email).toLowerCase() : null;
  } catch { return null; }
}
const isAdmin = (em) => !!em && (process.env.ADMIN_EMAILS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean).includes(em.toLowerCase());
const PK = () => process.env.PAYSTACK_SECRET_KEY || "";
async function ps(method, path, body) {
  try {
    const r = await fetch("https://api.paystack.co" + path, { method, headers: { Authorization: "Bearer " + PK(), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j.status !== false, j };
  } catch (e) { return { ok: false, j: { message: "Payment provider unreachable." } }; }
}
const akey = (em) => "acct-" + encodeURIComponent(em);
async function getAcct(em) { return (await rd(akey(em), null)) || { email: em, available: 0, locked: 0, bank: null, dva: null }; }
const saveAcct = (a) => wr(akey(a.email), a);
async function ngnValue(amount, ccy, o) {
  if (ccy === "NGN") return amount;
  if (o && o.want === "NGN" && o.rate > 0) return amount * o.rate;
  const r = await rd("rates", null); const pu = (r && r.perUSD) || FALL;
  return (amount / (pu[ccy] || FALL[ccy] || 1)) * (pu.NGN || FALL.NGN);
}
/* Send money to the vendor's saved account. Anything that can't be sent goes back to their free balance. */
async function payout(em, ref, amount, trade) {
  const list = await rd("payouts", []);
  let p = list.find((x) => x.ref === ref);
  if (!p) { p = { ref, email: em, amount, trade: trade || null, status: "queued", at: now() }; list.push(p); }
  if (["pending", "success", "pending_approval", "failed"].includes(p.status)) { await wr("payouts", list); return p; }
  const cfg = await rd("config", CFG0);
  if (amount > Number(cfg.thresh || 500000) && !p.approved) { p.status = "pending_approval"; await wr("payouts", list); return p; }
  const a = await getAcct(em);
  let ok = false;
  if (PK() && a.bank && a.bank.recipient_code) {
    const r = await ps("POST", "/transfer", { source: "balance", amount: Math.round(amount * 100), recipient: a.bank.recipient_code, reference: ref, reason: "Trex bond return" });
    ok = r.ok; if (!ok) p.note = r.j.message || "transfer failed";
  } else p.note = "no payout account";
  if (ok) p.status = "pending";
  else { p.status = "failed"; a.available += amount; await saveAcct(a); }
  await wr("payouts", list); return p;
}
async function settleBond(t, mode) {
  if (!t.bond_ngn || !t.bond_locked || t.bond_settled || !t.vendor_email) return;
  const a = await getAcct(t.vendor_email), b = t.bond_ngn;
  a.locked = Math.max(a.locked - b, 0);
  const back = mode === "forfeit" ? 0 : mode === "partial" ? b / 2 : mode === "refund" ? 0 : b;
  if (mode === "refund") a.available += b;
  await saveAcct(a); t.bond_settled = true;
  const l = await rd("ledger", []);
  if (mode === "forfeit" || mode === "partial") l.push({ id: "evt_" + hex(6), kind: "forfeit", trade: t.id, amount: mode === "partial" ? b / 2 : b, ccy: "NGN", at: now() });
  await wr("ledger", l);
  if (back > 0) await payout(t.vendor_email, ("bond-" + t.id).toLowerCase(), back, t.id);
}

async function sys(id, text) { const l = await rd("chat-" + id, []); l.push({ id: hex(4), from: "system", text, at: now() }); await wr("chat-" + id, l.slice(-500)); }
async function lockPending(em) {
  const trades = await rd("trades", []); let ch = false;
  for (const t of trades.filter((x) => x.vendor_email === em && x.state === "awaiting_bond").sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const a = await getAcct(em); if (a.available < t.bond_ngn) continue;
    a.available -= t.bond_ngn; a.locked += t.bond_ngn; await saveAcct(a);
    t.bond_locked = true; t.state = "opened"; ch = true;
    await sys(t.id, "Vendor bond received ✓ — customer, you can now send your payment.");
    await tradeMail(t, `Trade ${t.id} is ready for payment`, `The vendor secured the bond. Open the trade and send your payment.`);
  }
  if (ch) await wr("trades", trades);
  return ch;
}
const CONTACT = /(\+?\d[\d\s().-]{7,}\d)|whats\s*app|telegram|signal|wa\.me|t\.me|instagram|facebook|snap\s*chat|@[a-z0-9_.]{3,}|[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/i;
async function audit(e) { const l = await rd("audit", []); l.push({ at: now(), event: e }); await wr("audit", l.slice(-200)); }

let _smtp = null, _smtpKey = "";
async function email(to, subject, text) {
  if (!to) return { sent: false, reason: "no-key" };
  const gu = process.env.GMAIL_USER || "", gp = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  if (gu && gp) {
    try {
      if (!_smtp || _smtpKey !== gu + gp) { _smtpKey = gu + gp; const nm = await import("nodemailer"); const N = nm.default || nm; _smtp = N.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: gu, pass: gp } }); }
      await _smtp.sendMail({ from: `"Trex" <${gu}>`, to, subject, text });
      return { sent: true };
    } catch (e) { _smtp = null; return { sent: false, reason: "error" }; }
  }
  const key = process.env.RESEND_API_KEY || "";
  if (!key) return { sent: false, reason: "no-key" };
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.RESEND_FROM || "Trex <onboarding@resend.dev>", to: [to], subject, text }) });
    return { sent: r.ok };
  } catch { return { sent: false, reason: "error" }; }
}
async function tradeMail(t, s, x) { if (!t.email) return; const r = await email(t.email, s, x); await audit(`Email to ${t.email}: ${s} (${r.sent ? "sent" : "queued-no-key"})`); }

async function idem(req, body, fn) {
  const key = req.headers.get("x-idempotency-key") || body.idempotency_key;
  const keys = await rd("keys", {});
  if (key && keys[key]) return out(keys[key].response);
  const r = await fn(body);
  if (key && r && r.ok) { keys[key] = { response: r, at: now() }; await wr("keys", keys); }
  return out(r);
}
const free = (o, bond) => Number(o.capacity) - Number((bond.reserved || {})[o.id] || 0);
async function release(t, kind) {
  const bond = await rd("bond", BOND0);
  bond.reserved = bond.reserved || {};
  bond.reserved[t.offer_id] = Math.max(Number(bond.reserved[t.offer_id] || 0) - Number(t.amount), 0);
  await wr("bond", bond);
  const l = await rd("ledger", []);
  l.push({ id: "evt_" + hex(6), kind, trade: t.id, amount: kind === "forfeit" ? 0 : t.amount, ccy: t.provide, at: now() });
  await wr("ledger", l);
}

async function handle(req) {
  if (req.method === "OPTIONS") return new Response("", { status: 200, headers: H });
  const parts = new URL(req.url).pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const route = parts[0], M = req.method;
  const url = new URL(req.url);
  let body = {}, raw = "";
  if (M === "POST") { raw = await req.text(); try { body = JSON.parse(raw); } catch { body = {}; } }
  const me = await authOf(req);
  try {
    if (M === "GET" && route === "health") return out({ ok: true, service: "trex-api", time: now(), database: process.env.DATABASE_URL ? "postgres" : "blobs", auth: (await ba()) ? "better-auth" : "built-in", auth_note: _baErr, email: process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD ? "gmail" : process.env.RESEND_API_KEY ? "resend" : "preview" });
    if (M === "GET" && route === "rates") {
      let r = await rd("rates", null);
      const stale = !r || Date.now() - Date.parse(r.at) > 30 * 60 * 1000;
      if (stale) {
        try {
          const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 6000);
          const x = await fetch("https://open.er-api.com/v6/latest/USD", { signal: ac.signal }); clearTimeout(tm);
          const j = await x.json();
          if (j && j.result === "success" && j.rates && j.rates.NGN > 0) { r = { at: now(), source: "open.er-api.com", perUSD: j.rates }; await wr("rates", r); }
        } catch (e) { /* keep last good rates */ }
      }
      if (!r) return err("Live rates unavailable right now.", 503);
      return out({ ok: true, at: r.at, source: r.source, stale: Date.now() - Date.parse(r.at) > 30 * 60 * 1000, perUSD: r.perUSD });
    }
    if (M === "GET" && route === "integrations")
      return out({ ok: true, resend: !!process.env.RESEND_API_KEY, email: !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) ? "gmail" : process.env.RESEND_API_KEY ? "resend" : "none", sms: false, paystack: !!process.env.PAYSTACK_SECRET_KEY, auth: true, admins: !!process.env.ADMIN_EMAILS });

    if (M === "POST" && route === "otp") {
      const target = String(body.email || body.phone || "").trim().toLowerCase();
      if (!target || !target.includes("@")) return err("A valid email is required.");
      let code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      const B = await ba();
      if (B) { try { delete _lastOtp[target]; await B.api.sendVerificationOTP({ body: { email: target, type: "sign-in" } }); if (_lastOtp[target]) code = _lastOtp[target]; } catch (e) { _baErr = String((e && e.message) || e).slice(0, 200); } }
      const o = (await rd("otp", [])).filter((x) => x.target !== target);
      o.push({ target, code, exp: Math.floor(Date.now() / 1000) + 600, attempts: 0 });
      await wr("otp", o);
      await audit(`OTP requested for ${target}`);
      const r = await email(target, "Your Trex code", `Your Trex code is ${code}. It expires in 10 minutes.`);
      if (r.sent) return out({ ok: true, email_sent: true, expires_in: 600 });
      if (r.reason === "no-key" && isAdmin(target)) return err("Email sending is not set up yet, so the admin account cannot sign in. Add GMAIL_USER and GMAIL_APP_PASSWORD in Netlify first.", 503);
      if (r.reason === "no-key") return out({ ok: true, demo_code: code, expires_in: 600, preview: true });
      return err("Email failed to send — check the address and try again.", 502);
    }
    if (M === "POST" && route === "verify") {
      const target = String(body.email || body.phone || "").trim().toLowerCase();
      const o = await rd("otp", []);
      const rec = o.find((x) => x.target === target);
      let token = null, engine = "built-in";
      const B = await ba();
      if (B && body.code && rec && Math.floor(Date.now() / 1000) <= rec.exp) {
        try {
          const r = await B.api.signInEmailOTP({ body: { email: target, otp: String(body.code) }, returnHeaders: true });
          const hdr = r && r.headers && r.headers.get && r.headers.get("set-auth-token");
          const cand = (r && r.response && r.response.token) || (r && r.token) || hdr || null;
          if (cand) {
            const raw = decodeURIComponent(String(cand)).split(".")[0];
            if ((await sessionEmail(raw)) === target) token = raw; else _baErr = "Better Auth returned a session the server could not validate.";
          } else _baErr = "Better Auth returned no session token.";
        } catch (e) { _baErr = String((e && e.message) || e).slice(0, 200); }
      }
      if (token) { engine = "better-auth"; await wr("otp", o.filter((x) => x.target !== target)); }
      else {
        if (!rec || Date.now() / 1000 > rec.exp) return err("Code expired. Please request a new one.");
        if (rec.attempts >= 5) return err("Too many tries. Please request a new code.");
        if (String(body.code) !== rec.code) { rec.attempts++; await wr("otp", o); return err("That code doesn't match. Check and try again."); }
        await wr("otp", o.filter((x) => x.target !== target)); token = await mkToken(target);
      }
      const prev = await rd("user-" + target, null);
      const u = prev || { email: target, created: now() };
      if (body.country) u.country = String(body.country).slice(0, 2).toUpperCase();
      await wr("user-" + target, u);
      await audit(`Verified ${target} (${engine})`);
      return out({ ok: true, token, email: target, engine, is_new: !prev, country: u.country || null });
    }
    if (M === "POST" && route === "signout") {
      try { const c = await pg(); const raw = decodeURIComponent((req.headers.get("authorization") || "").replace(/^Bearer /, "")).split(".")[0]; if (c && raw) await c.query('delete from "session" where token = $1', [raw]); } catch { /* token simply expires */ }
      return out({ ok: true });
    }

    if (M === "GET" && route === "authcheck") {
      if (!me) return err("Sign in with an admin email first, then open this page again.", 401);
      if (!isAdmin(me)) return err("Admin access only.", 403);
      const steps = []; const step = (n, okk, note) => steps.push({ step: n, ok: !!okk, note: note || "" });
      const probe = "authcheck+" + hex(3).toLowerCase() + "@trex.invalid";
      try {
        const c = await pg(); step("Postgres connection", !!c, c ? "" : "DATABASE_URL is not set");
        if (c) {
          await c.query('select 1 from "user" limit 1'); await c.query('select 1 from "session" limit 1'); step("Better Auth tables exist", true);
          const B = await ba(); step("Better Auth starts", !!B, B ? "" : _baErr);
          if (B) {
            delete _lastOtp[probe]; await B.api.sendVerificationOTP({ body: { email: probe, type: "sign-in" } });
            step("Better Auth creates a code", !!_lastOtp[probe]);
            const r = await B.api.signInEmailOTP({ body: { email: probe, otp: _lastOtp[probe] }, returnHeaders: true });
            const cand = (r && r.response && r.response.token) || (r && r.token) || (r && r.headers && r.headers.get && r.headers.get("set-auth-token"));
            step("Better Auth signs a user in", !!cand);
            const em = cand ? await sessionEmail(cand) : null; step("Server accepts the Better Auth session", em === probe, em ? "" : "session lookup failed");
            await c.query('delete from "user" where email = $1', [probe]);
          }
        }
      } catch (e) { step("Unexpected error", false, String((e && e.message) || e).slice(0, 300)); }
      return out({ ok: steps.every((x) => x.ok), steps });
    }
    const needAuth = () => (me ? null : err("Please create an account or sign in first.", 401));
    const needAdmin = () => (!me ? err("Please sign in first.", 401) : isAdmin(me) ? null : err("Admin access only.", 403));
    let e401;
    const pubT = (t) => { const { vendor_email, customer_email, email, ...r } = t; return { ...r, role: me && me === vendor_email ? "vendor" : "customer" }; };

    if (route === "liveness") {
      const sub = parts[1];
      if (sub === "flags" && M === "GET") { if ((e401 = needAdmin())) return e401; return out({ ok: true, flags: (await rd("liveflags", [])).filter((f) => !f.cleared) }); }
      if (sub === "clear" && M === "POST") {
        if ((e401 = needAdmin())) return e401;
        const em = String(body.email || "").toLowerCase(), u = await rd("live-" + em, null); if (!u) return err("No face check found for that email.", 404);
        u.status = "verified"; await wr("live-" + em, u);
        const fl = await rd("liveflags", []); fl.forEach((x) => { if (x.email === em) x.cleared = true; }); await wr("liveflags", fl); await audit(`Face check cleared for ${em} by ${me}`);
        return out({ ok: true });
      }
      if ((e401 = needAuth())) return e401;
      if (sub === "me" && M === "GET") { const u = await rd("live-" + me, null); return out({ ok: true, status: u ? u.status : "none" }); }
      if (M === "POST") {
        const fr = Array.isArray(body.frames) ? body.frames : [], fb = !!body.fallback;
        if (fr.length !== 3 || fr.some((x) => !/^data:image\/jpeg;base64,/.test(String(x)) || String(x).length > 120000)) return err("Face check images were not accepted. Please try again.");
        if (!/^[0-9a-f]{16}$/.test(String(body.hash || ""))) return err("Face check failed. Please try again.");
        const motion = Number(body.motion) || 0;
        if (!fb && motion < 3) return err("We couldn't see you move. Try again in good light and follow each instruction.");
        const hashes = (await rd("livehashes", [])).filter((h) => h.email !== me);
        const pop = (x) => x.toString(2).split("1").length - 1, mine = BigInt("0x" + body.hash);
        const dup = hashes.find((h) => pop(mine ^ BigInt("0x" + h.hash)) <= 3);
        const status = dup || fb ? "review" : "verified";
        hashes.push({ email: me, hash: body.hash }); await wr("livehashes", hashes);
        await wr("live-" + me, { email: me, at: now(), hash: body.hash, frames: fr, motion, challenges: body.challenges || [], status, fallback: fb });
        if (dup) { const fl = await rd("liveflags", []); fl.push({ email: me, match: dup.email, at: now() }); await wr("liveflags", fl); }
        await audit(`Face check ${status} for ${me}`);
        return out({ ok: true, status });
      }
    }
    if (route === "banks" && M === "GET") {
      let b = await rd("banks", null);
      if ((!b || Date.now() - Date.parse(b.at) > 864e5) && PK()) {
        const r = await ps("GET", "/bank?country=nigeria&perPage=200&currency=NGN");
        if (r.ok && Array.isArray(r.j.data)) { b = { at: now(), list: r.j.data.map((x) => ({ name: x.name, code: x.code })) }; await wr("banks", b); }
      }
      return out({ ok: true, banks: (b && b.list) || [] });
    }

    if (route === "paystack" && M === "POST") {
      const sig = req.headers.get("x-paystack-signature") || "";
      const good = PK() ? crypto.createHmac("sha512", PK()).update(raw).digest("hex") : "";
      if (!good || sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return err("Bad signature.", 401);
      const ev = body.event, d = body.data || {};
      if (ev === "charge.success" && d.channel === "dedicated_nuban" && (d.currency || "NGN") === "NGN") {
        const refs = await rd("refs", {}); const rid = "chg-" + (d.reference || d.id);
        const em = String((d.customer && d.customer.email) || "").toLowerCase();
        if (!refs[rid] && em) {
          const a = await getAcct(em); const amt = Number(d.amount) / 100;
          a.available += amt; await saveAcct(a); refs[rid] = 1; await wr("refs", refs);
          const l = await rd("ledger", []); l.push({ id: "evt_" + hex(6), kind: "topup", trade: null, amount: amt, ccy: "NGN", at: now() }); await wr("ledger", l);
          await audit(`Bond funded ${amt} NGN for ${em}`);
          await lockPending(em);
        }
      } else if (ev === "dedicatedaccount.assign.success") {
        const em = String((d.customer && d.customer.email) || "").toLowerCase(); const da = d.dedicated_account || {};
        if (em && da.account_number) { const a = await getAcct(em); a.dva = { account_number: da.account_number, account_name: da.account_name, bank: da.bank && da.bank.name }; await saveAcct(a); }
      } else if (ev === "transfer.success" || ev === "transfer.failed" || ev === "transfer.reversed") {
        const ps_ = await rd("payouts", []); const p = ps_.find((x) => x.ref === d.reference);
        if (p && p.status === "pending") {
          if (ev === "transfer.success") { p.status = "success"; p.done = now(); await wr("payouts", ps_);
            const l = await rd("ledger", []); l.push({ id: "evt_" + hex(6), kind: "release", trade: p.trade, amount: p.amount, ccy: "NGN", at: now() }); await wr("ledger", l); }
          else { p.status = "failed"; await wr("payouts", ps_); const a = await getAcct(p.email); a.available += p.amount; await saveAcct(a); }
          await audit(`Payout ${p.ref} ${p.status}`);
        }
      }
      return out({ ok: true });
    }

    if (route === "offers") {
      let list = await rd("offers", null);
      if (!list) { list = SEED; await wr("offers", list); }
      if (M === "GET") {
        const src = url.searchParams.get("all") === "1" ? list : list.filter((o) => o.live);
        return out({ ok: true, offers: src.map(({ owner, ...o }) => ({ ...o, mine: !!me && owner === me })) });
      }
      if ((e401 = needAuth())) return e401;
      if (!body.id) { const lv = await rd("live-" + me, null); if (lv && lv.status === "review") return err("Your account is under a quick review. Our team will contact you shortly.", 403); }
      if (body.id) {
        const o = list.find((x) => x.id === body.id);
        if (!o) return err("Offer not found.", 404);
        if (o.owner !== me && !isAdmin(me)) return err("That offer isn't yours.", 403);
        if (body.delete) { await wr("offers", list.filter((x) => x.id !== body.id)); await audit(`Offer deleted ${body.id}`); return out({ ok: true }); }
        for (const k of ["rate", "min", "max", "methods", "terms", "avail", "live", "vendor"]) if (body[k] !== undefined && body[k] !== null) o[k] = body[k];
        await wr("offers", list); await audit(`Offer updated ${o.id}`); return out({ ok: true });
      }
      if (!body.provide || !body.want) return err("Provide and want currencies are required.");
      if (body.provide === body.want) return err("Pick two different currencies.");
      if (!(Number(body.rate) > 0)) return err("Set a rate above zero.");
      if (!(Number(body.max) > Number(body.min))) return err("Maximum must be above minimum.");
      const o = { id: "OFR-" + hex(3), owner: me, provide: body.provide, want: body.want, rate: +body.rate, min: +body.min, max: +body.max,
        vendor: body.vendor || "Vendor", country: body.country || "NG", tier: "Probation", capacity: +(body.capacity || 5000), rating: null, trades: 0,
        methods: body.methods || ["Bank transfer"], terms: body.terms || "", photo: body.photo || null, bio: body.bio || "", pledge: body.pledge, langs: body.langs, live: true };
      list.push(o); await wr("offers", list); await audit(`Offer published ${o.id} ${o.provide}->${o.want}`);
      const { owner, ...pub } = o; return out({ ok: true, offer: pub });
    }

    if (M === "POST" && route === "trades") {
      if ((e401 = needAuth())) return e401;
      return idem(req, body, async (b) => {
        const offers = await rd("offers", SEED);
        const o = offers.find((x) => x.id === b.offer_id && x.live);
        if (!o) return { ok: false, error: "Offer unavailable." };
        if (o.owner && o.owner === me) return { ok: false, error: "You can't trade against your own offer." };
        const amt = Number(b.amount);
        if (!(amt > 0)) return { ok: false, error: "Enter an amount above zero." };
        if (o.max && amt > o.max) return { ok: false, error: `Above this offer's maximum (${o.max} ${o.provide}).` };
        if (o.min && amt < o.min) return { ok: false, error: `Below this offer's minimum (${o.min} ${o.provide}).` };
        const bond = await rd("bond", BOND0); bond.reserved = bond.reserved || {};
        if (amt > free(o, bond)) return { ok: false, error: "This offer cannot cover that amount right now." };
        let bondN = 0;
        if (PK() && o.owner) bondN = Math.round((await ngnValue(amt, o.provide, o)) * 0.5 * 100) / 100;
        bond.reserved[o.id] = Number(bond.reserved[o.id] || 0) + amt; await wr("bond", bond);
        const cfg = await rd("config", CFG0);
        const t = { id: "TXN-" + hex(4), offer_id: o.id, sell: b.sell, recv: b.recv, amount: amt, email: me, customer_email: me, vendor_email: o.owner || null, bond_ngn: bondN,
          provide: o.provide, vendor: o.vendor, rate: o.rate, fee_pct: cfg.fee_pct || 1.5, state: o.owner ? "awaiting_vendor" : "opened", proof: null, created_at: now() };
        const trades = await rd("trades", []); trades.push(t); await wr("trades", trades);
        const l = await rd("ledger", []); l.push({ id: "evt_" + hex(6), kind: "reserve", trade: t.id, amount: amt, ccy: o.provide, at: now() }); await wr("ledger", l);
        await audit(`Trade opened ${t.id}`);
        await sys(t.id, o.owner ? "Trade opened. Waiting for the vendor to accept." : "Trade opened.");
        await tradeMail(t, `Your ${b.sell}→${b.recv} trade request was sent`, `Trade ${t.id}: waiting for the vendor to accept.`);
        if (t.vendor_email) await email(t.vendor_email, "New Trex order — accept it", `Trade ${t.id}: a customer wants ${amt} ${o.provide}. Open your vendor dashboard to accept or decline.`);
        return { ok: true, trade: pubT(t) };
      });
    }
    if (M === "GET" && route === "trades") {
      if ((e401 = needAuth())) return e401;
      const all = await rd("trades", []);
      return out({ ok: true, trades: all.filter((t) => isAdmin(me) || t.customer_email === me || t.vendor_email === me).map(pubT) });
    }

    if (M === "POST" && route === "trade_action") {
      if ((e401 = needAuth())) return e401;
      return idem(req, body, async (b) => {
        const trades = await rd("trades", []);
        const t = trades.find((x) => x.id === b.id);
        if (!t) return { ok: false, error: "Trade not found." };
        const isV = !!t.vendor_email && me === t.vendor_email, isC = me === t.customer_email;
        if (!isV && !isC) return { ok: false, error: "This isn't your trade." };
        const a = String(b.action);
        const roleOK = { accept: isV, decline: isV, pay: isC, cancel: true, complete: isC, confirm: t.vendor_email ? isV : isC, deliver: t.vendor_email ? isV : isC, dispute: true }[a];
        const allowed = { awaiting_vendor: ["accept", "decline", "cancel"], awaiting_bond: ["decline", "cancel"], opened: ["pay", "cancel"], payment_sent: ["confirm", "dispute"], payment_confirmed: ["deliver", "dispute"], delivery_sent: ["complete", "dispute"] };
        if (!(allowed[t.state] || []).includes(a)) return { ok: false, error: `Cannot ${a} a ${t.state} trade.` };
        if (!roleOK) return { ok: false, error: ["confirm", "deliver", "accept", "decline"].includes(a) ? "Only the vendor can do this step." : "Only the customer can do this step." };
        if (a === "pay" && !String(b.proof || "")) return { ok: false, error: "Attach your payment receipt first." };
        if (a === "deliver" && t.vendor_email && !String(b.proof || "")) return { ok: false, error: "Attach proof of delivery first." };
        if (a === "accept") {
          if (PK() && t.bond_ngn) {
            const u = await rd("user-" + me, {});
            if (u.country && u.country !== "NG") return { ok: false, error: "Bond for your country is coming soon. Bonds are available in naira (Nigeria) only for now." };
            const acc = await getAcct(me);
            if (acc.available >= t.bond_ngn) { acc.available -= t.bond_ngn; acc.locked += t.bond_ngn; await saveAcct(acc); t.bond_locked = true; t.state = "opened"; }
            else t.state = "awaiting_bond";
          } else t.state = "opened";
        } else t.state = { pay: "payment_sent", confirm: "payment_confirmed", deliver: "delivery_sent", complete: "completed", cancel: "cancelled", dispute: "disputed", decline: "cancelled" }[a];
        const SM = { accept: t.state === "awaiting_bond" ? `Vendor accepted and is depositing the ₦${t.bond_ngn} bond. Please wait.` : "Vendor accepted. Customer, you can now send your payment.", decline: "Vendor declined this trade.", cancel: "Trade cancelled.", pay: "Customer marked payment as sent.", confirm: "Vendor confirmed the payment.", deliver: "Vendor says the currency was sent.", complete: "Customer confirmed receipt. Trade complete ✓", dispute: "A problem was reported. Trex is reviewing this trade." };
        await sys(t.id, SM[a]);
        if (b.proof) { if (a === "deliver") t.delivery_proof = b.proof; else t.proof = b.proof; }
        if (b.text) (t.chat ||= []).push({ from: isV ? "vendor" : "customer", text: String(b.text), at: now() });
        if (t.state === "completed") { await release(t, "release"); await settleBond(t, "return"); }
        if (t.state === "cancelled") { await release(t, "refund"); await settleBond(t, "refund"); }
        if (t.state === "disputed") {
          const d = await rd("disputes", []);
          d.push({ id: "DSP-" + hex(3), trade: t.id, pair: `${t.sell}-${t.recv}`, amount: t.amount, cur: t.sell, vendor: t.vendor, proof: t.proof, delivery_proof: t.delivery_proof, rate: t.rate,
            bond_ngn: t.bond_ngn, method: b.method, chat: (t.chat || []).map((m) => m.text).join("\n"), state: "OPEN", at: now() });
          await wr("disputes", d);
        }
        await wr("trades", trades); await audit(`Trade ${t.id} → ${t.state}`);
        const pair = `${t.sell}→${t.recv}`;
        if (t.state === "completed") await tradeMail(t, `Receipt ${t.id} — trade complete`, `You sent ${t.amount} ${t.sell} and received ${t.recv} at ${t.rate}. Ref ${t.id}.`);
        if (t.state === "disputed") await tradeMail(t, `Your ${pair} trade is under review`, `Trade ${t.id} is paused. Our team reviews it, usually within 24 hours.`);
        if (t.state === "cancelled") await tradeMail(t, `Trade ${t.id} cancelled`, "Cancelled before payment. Nothing left your account.");
        if (a === "accept") await tradeMail(t, `Vendor accepted trade ${t.id}`, t.state === "opened" ? "You can now send your payment." : "The vendor is securing the bond. We will email you when you can pay.");
        if (t.vendor_email && t.state === "payment_sent") await email(t.vendor_email, "Payment sent — confirm it", `Trade ${t.id}: the customer marked payment as sent. Confirm receipt in your vendor dashboard.`);
        if (t.state === "delivery_sent") await tradeMail(t, `Confirm your ${t.recv}`, `Trade ${t.id}: the vendor says they've sent your currency. Please confirm receipt.`);
        return { ok: true, trade: pubT(t) };
      });
    }

    if (route === "chat") {
      if ((e401 = needAuth())) return e401;
      const tid = M === "GET" ? url.searchParams.get("trade") : body.trade;
      const trades = await rd("trades", []); const t = trades.find((x) => x.id === tid);
      if (!t) return err("Trade not found.", 404);
      const isV = !!t.vendor_email && me === t.vendor_email, isC = me === t.customer_email;
      const adm = isAdmin(me) && ["disputed", "resolved"].includes(t.state);
      if (!isV && !isC && !adm) return err("This chat is private to the two traders.", 403);
      const role = isV ? "vendor" : isC ? "customer" : "admin", other = role === "vendor" ? "customer" : "vendor";
      const key = "chat-" + tid, rk = "read-" + tid;
      const list = await rd(key, []), rr = await rd(rk, {});
      if (M === "GET") {
        const since = url.searchParams.get("since") || "";
        if (role !== "admin" && (!rr[role] || Date.now() - Date.parse(rr[role]) > 4000)) { rr[role] = now(); await wr(rk, rr); }
        return out({ ok: true, role, state: t.state, messages: since ? list.filter((m) => m.at > since) : list, other_read: rr[other] || null, server_time: now() });
      }
      if (role === "admin") return err("Admins can read this chat but not post in it.", 403);
      const text = String(body.text || "").trim().slice(0, 1000), img = body.image ? String(body.image) : "";
      if (!text && !img) return err("Type a message first.");
      if (img && (!/^data:image\/(jpeg|png|webp);base64,/.test(img) || img.length > 450000)) return err("That image is too large or not supported.");
      if (text && CONTACT.test(text)) {
        list.push({ id: hex(4), from: "system", text: "A message was held: sharing phone numbers or other apps is not allowed. Trades taken off Trex lose bond protection.", at: now() });
        await wr(key, list.slice(-500)); return out({ ok: false, held: true, error: "Message held — sharing contact details off Trex removes your bond protection." });
      }
      const m = { id: hex(4), from: role, text, at: now() }; if (img) m.img = img;
      list.push(m); await wr(key, list.slice(-500));
      rr[role] = m.at;
      const quiet = !rr[other] || Date.now() - Date.parse(rr[other]) > 3 * 60e3;
      if (quiet && (!rr["n-" + other] || Date.now() - Date.parse(rr["n-" + other]) > 15 * 60e3)) {
        rr["n-" + other] = now(); await email(other === "vendor" ? t.vendor_email : t.customer_email, `New message on trade ${t.id}`, `You have a new message on Trex trade ${t.id}. Open the trade to reply.`);
      }
      await wr(rk, rr);
      return out({ ok: true, message: m });
    }
    if (M === "GET" && route === "disputes") { if ((e401 = needAdmin())) return e401; return out({ ok: true, disputes: await rd("disputes", []) }); }
    if (M === "POST" && route === "resolve") {
      if ((e401 = needAdmin())) return e401;
      return idem(req, body, async (b) => {
        const ds = await rd("disputes", []);
        const d = ds.find((x) => x.id === b.id);
        if (!d) return { ok: false, error: "Case not found." };
        if (d.state !== "OPEN") return { ok: false, error: "Already resolved." };
        if (!["VENDOR-AT-FAULT", "EXONERATED", "PARTIAL"].includes(b.how)) return { ok: false, error: "Unknown outcome." };
        const cfg = await rd("config", CFG0);
        if (Number(d.amount) > Number(cfg.thresh || 500000) && !b.second_approval) return { ok: false, error: "Large amount — second approval required.", need_second: true };
        d.state = "RESOLVED-" + b.how; d.resolved_at = now(); d.resolved_by = me; await wr("disputes", ds);
        const trades = await rd("trades", []);
        const t = trades.find((x) => x.id === d.trade);
        if (t) {
          t.state = "resolved"; await release(t, b.how === "VENDOR-AT-FAULT" ? "forfeit" : "release");
          await settleBond(t, b.how === "VENDOR-AT-FAULT" ? "forfeit" : b.how === "PARTIAL" ? "partial" : "return");
          await wr("trades", trades);
          await tradeMail(t, `Review complete — trade ${t.id}`, b.how === "VENDOR-AT-FAULT" ? "Decided in your favour. Compensation comes from the vendor's bond." : `Decided: ${b.how}.`);
        }
        await audit(`Dispute ${d.id} resolved ${b.how} by ${me}`);
        return { ok: true, dispute: d };
      });
    }

    if (route === "bond") {
      const sub = parts[1];
      if (!sub) { if (M === "GET") return out({ ok: true, bond: await rd("bond", BOND0) }); return err("Use your bond account.", 405); }
      if (sub === "pending" && M === "GET") { if ((e401 = needAdmin())) return e401; return out({ ok: true, payouts: (await rd("payouts", [])).filter((p) => p.status === "pending_approval") }); }
      if (sub === "approve" && M === "POST") {
        if ((e401 = needAdmin())) return e401;
        const ps_ = await rd("payouts", []); const p = ps_.find((x) => x.ref === body.ref && x.status === "pending_approval");
        if (!p) return err("Nothing to approve.", 404);
        if (p.approved_by === me) return err("A second team member must approve.", 403);
        p.approved = true; p.approved_by = me; p.status = "queued"; await wr("payouts", ps_);
        const r = await payout(p.email, p.ref, p.amount, p.trade); await audit(`Payout ${p.ref} approved by ${me}`);
        return out({ ok: true, status: r.status });
      }
      if ((e401 = needAuth())) return e401;
      const a = await getAcct(me);
      const uinfo = await rd("user-" + me, {}); const bondOK = !uinfo.country || uinfo.country === "NG";
      if (sub === "check" && M === "POST") { const ch = await lockPending(me); return out({ ok: true, started: ch }); }
      if (sub === "me" && M === "GET") {
        const mine = (await rd("payouts", [])).filter((p) => p.email === me).slice(-10).reverse();
        return out({ ok: true, configured: !!PK(), bond_currency: "NGN", supported: bondOK, country: uinfo.country || null, available: a.available, locked: a.locked, dva: a.dva || null,
          bank: a.bank ? { account_name: a.bank.account_name, bank_name: a.bank.bank_name, last4: String(a.bank.account_number).slice(-4) } : null, payouts: mine });
      }
      if (!PK()) return err("Payments aren't switched on yet.", 503);
      if (!bondOK) return err("Bond for your country is coming soon. Right now bonds are available in naira (Nigeria) only.", 403);
      if (sub === "account" && M === "POST") {
        const an = String(body.account_number || "").replace(/\D/g, ""), bc = String(body.bank_code || "");
        if (an.length !== 10 || !bc) return err("Enter your 10-digit account number and choose your bank.");
        const rs = await ps("GET", `/bank/resolve?account_number=${an}&bank_code=${encodeURIComponent(bc)}`);
        if (!rs.ok) return err("We couldn't verify that account. Check the number and bank.");
        const rc = await ps("POST", "/transferrecipient", { type: "nuban", name: rs.j.data.account_name, account_number: an, bank_code: bc, currency: "NGN" });
        if (!rc.ok) return err(rc.j.message || "Couldn't save that account.");
        a.bank = { account_name: rs.j.data.account_name, account_number: an, bank_code: bc, bank_name: rc.j.data.details && rc.j.data.details.bank_name, recipient_code: rc.j.data.recipient_code };
        await saveAcct(a); await audit(`Payout account saved for ${me}`);
        return out({ ok: true, bank: { account_name: a.bank.account_name, bank_name: a.bank.bank_name, last4: an.slice(-4) } });
      }
      if (sub === "deposit" && M === "POST") {
        if (!a.dva) {
          if (!a.customer_code) {
            const [fn, ...ln] = String(body.name || "Trex Vendor").trim().split(/\s+/);
            const c = await ps("POST", "/customer", { email: me, first_name: fn || "Trex", last_name: ln.join(" ") || "Vendor" });
            if (!c.ok) return err(c.j.message || "Couldn't set up your deposit account.");
            a.customer_code = c.j.data.customer_code;
          }
          const d = await ps("POST", "/dedicated_account", { customer: a.customer_code, preferred_bank: process.env.PAYSTACK_BANK || "wema-bank" });
          if (d.ok && d.j.data && d.j.data.account_number) a.dva = { account_number: d.j.data.account_number, account_name: d.j.data.account_name, bank: d.j.data.bank && d.j.data.bank.name };
          else if (!d.ok) { await saveAcct(a); return err(d.j.message || "Couldn't create your deposit account."); }
          await saveAcct(a);
        }
        return out({ ok: true, dva: a.dva || null, pending: !a.dva });
      }
      if (sub === "withdraw" && M === "POST") return idem(req, body, async (b) => {
        const acc = await getAcct(me); const amt = Math.round(Number(b.amount) * 100) / 100;
        if (!(amt > 0) || amt > acc.available) return { ok: false, error: "That exceeds your free balance." };
        if (!acc.bank) return { ok: false, error: "Add your payout account first." };
        acc.available -= amt; await saveAcct(acc);
        const p = await payout(me, "withdraw-" + hex(6).toLowerCase(), amt, null); await audit(`Withdrawal ${amt} NGN ${p.status} for ${me}`);
        return { ok: true, status: p.status };
      });
      return err("Unknown endpoint.", 404);
    }

    if (route === "config") {
      let c = await rd("config", CFG0);
      if (M === "POST") {
        if ((e401 = needAdmin())) return e401;
        for (const k of ["fee_pct", "confirm_mins", "grace_hours", "thresh", "disabled", "pausedPairs"]) if (body[k] !== undefined && body[k] !== null) c[k] = body[k];
        await wr("config", c); await audit("Settings updated");
      }
      return out({ ok: true, config: c });
    }
    if (M === "GET" && route === "ledger") { if ((e401 = needAdmin())) return e401; return out({ ok: true, ledger: await rd("ledger", []) }); }
    if (route === "ratings") {
      const r = await rd("ratings", []);
      if (M === "POST") { if ((e401 = needAuth())) return e401; r.push({ trade: body.trade, rating: body.rating, by: me, at: now() }); await wr("ratings", r); return out({ ok: true }); }
      return out({ ok: true, ratings: r.map(({ by, ...x }) => x) });
    }
    if (route === "tickets") {
      const t = await rd("tickets", []);
      if (M === "POST") {
        if (!body.title) return err("Describe the issue first.");
        t.push({ id: "TCK-" + hex(3), cat: body.cat || "General", title: body.title, by: me || null, at: now() }); await wr("tickets", t); await audit("Ticket opened");
        return out({ ok: true });
      }
      if ((e401 = needAdmin())) return e401;
      return out({ ok: true, tickets: t });
    }
    if (M === "GET" && route === "audit") { if ((e401 = needAdmin())) return e401; return out({ ok: true, audit: await rd("audit", []) }); }
    return err("Unknown endpoint.", 404);
  } catch (e) {
    return err("Server error — please retry.", 500);
  }
}

export default async (req) => {
  let c = null;
  try { c = await pg(); } catch (e) { _pgErr = String((e && e.message) || e).slice(0, 160); return out({ ok: false, error: "Database unavailable — please retry shortly." }, 503); }
  const post = req.method === "POST";
  if (c && post) await c.query("select pg_advisory_lock(727272)");
  try { return await handle(req); }
  finally { if (c && post) await c.query("select pg_advisory_unlock(727272)").catch(() => {}); }
};
