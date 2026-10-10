import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

export const config = { path: "/api/*" };

/* ---------- basics ---------- */
const st = () => getStore({ name: "trex", consistency: "strong" });
const hex = (n) => crypto.randomBytes(n).toString("hex").toUpperCase();
const now = () => new Date().toISOString();
const J = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const out = (o, s = 200, extra = {}) => new Response(JSON.stringify(o), { status: s, headers: { ...J, ...extra } });
const err = (m, s = 422, x = {}) => out({ ok: false, error: m, ...x }, s);
const money = (n) => Math.round(Number(n) * 100) / 100;

/* ---------- storage: Postgres (Neon) when DATABASE_URL is set, else Netlify Blobs ---------- */
let _pg = null;
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

/* ---------- sessions, passwords, Better Auth ---------- */
async function secret() { let s = await rd("secret", null); if (!s) { s = { v: crypto.randomBytes(32).toString("hex") }; await wr("secret", s); } return s.v; }
async function sign(p) { return crypto.createHmac("sha256", await secret()).update(p).digest("base64url"); }
async function mkToken(em, v) { const p = Buffer.from(JSON.stringify({ e: em, x: Date.now() + 30 * 864e5, v: v || 0 })).toString("base64url"); return p + "." + (await sign(p)); }
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));
async function hashPw(pw) { const s = crypto.randomBytes(16); return "s1$" + s.toString("hex") + "$" + (await scrypt(pw, s)).toString("hex"); }
async function checkPw(pw, h) { const [v, s, k] = String(h || "").split("$"); if (v !== "s1" || !s || !k) return false; const d = await scrypt(pw, Buffer.from(s, "hex")), b = Buffer.from(k, "hex"); return d.length === b.length && crypto.timingSafeEqual(d, b); }
const pwOK = (p) => typeof p === "string" && p.length >= 8 && p.length <= 128 && /[A-Za-z]/.test(p) && /\d/.test(p);
const isAdmin = (em) => !!em && (process.env.ADMIN_EMAILS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean).includes(String(em).toLowerCase());
const U = async (em) => (em ? await rd("user-" + em, null) : null);

let _ba = null, _baErr = null;
async function ba() {
  if (_ba !== null) return _ba || null;
  if (!process.env.DATABASE_URL) { _ba = false; return null; }
  try {
    const { betterAuth } = await import("better-auth");
    const { bearer } = await import("better-auth/plugins");
    const mod = await import("pg"); const P = mod.default || mod;
    const pool = new P.Pool({ connectionString: process.env.DATABASE_URL, max: 3, ssl: { rejectUnauthorized: false } });
    _ba = betterAuth({ database: pool, secret: await secret(), basePath: "/api/auth",
      baseURL: process.env.URL || process.env.SITE_URL || "http://localhost:8888",
      emailAndPassword: { enabled: true, minPasswordLength: 8, requireEmailVerification: false, autoSignIn: false },
      plugins: [bearer()] });
  } catch (e) { _baErr = String((e && e.message) || e).slice(0, 200); _ba = false; }
  return _ba || null;
}
async function sessionEmail(t) {
  try {
    const c = await pg(); if (!c) return null;
    const raw = decodeURIComponent(String(t)).split(".")[0]; if (!raw) return null;
    const r = await c.query('select u.email from "session" s join "user" u on u.id = s."userId" where s.token = $1 and s."expiresAt" > now()', [raw]);
    return r.rows.length ? String(r.rows[0].email).toLowerCase() : null;
  } catch { return null; }
}
async function emailFromToken(t) {
  if (!t) return null;
  const [p, sg] = t.split(".");
  if (p && sg) {
    const good = await sign(p);
    if (sg.length === good.length && crypto.timingSafeEqual(Buffer.from(sg), Buffer.from(good))) {
      try { const o = JSON.parse(Buffer.from(p, "base64url").toString()); if (o.x > Date.now()) { const u = await U(o.e); return u && (u.tokv || 0) === (o.v || 0) ? String(o.e) : null; } } catch { /* fall through */ }
    }
  }
  return sessionEmail(t);
}
async function authOf(req) {
  let t = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!t && req.method === "GET") { const m = /(?:^|;\s*)trex_session=([^;]+)/.exec(req.headers.get("cookie") || ""); if (m) t = decodeURIComponent(m[1]); }
  const em = await emailFromToken(t); if (!em) return null;
  const u = await U(em); return u && u.verified && !u.suspended ? em : null;
}
const cookie = (t) => `trex_session=${encodeURIComponent(t)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;

/* ---------- email (Gmail SMTP first, Resend second) ---------- */
let _smtp = null, _smtpKey = "", _mailErr = null;
async function email(to, subject, text) {
  if (!to) return { sent: false, reason: "no-key" };
  const gu = process.env.GMAIL_USER || "", gp = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  if (gu && gp) {
    try {
      if (!_smtp || _smtpKey !== gu + gp) { _smtpKey = gu + gp; const nm = await import("nodemailer"); const N = nm.default || nm; _smtp = N.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: gu, pass: gp } }); }
      await _smtp.sendMail({ from: `"Trex" <${gu}>`, to, subject, text });
      return { sent: true };
    } catch (e) { _smtp = null; _mailErr = String((e && e.message) || e).slice(0, 160); return { sent: false, reason: "error" }; }
  }
  const key = process.env.RESEND_API_KEY || "";
  if (!key) return { sent: false, reason: "no-key" };
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.RESEND_FROM || "Trex <onboarding@resend.dev>", to: [to], subject, text }) });
    return { sent: r.ok };
  } catch { return { sent: false, reason: "error" }; }
}

/* ---------- Paystack ---------- */
const PK = () => process.env.PAYSTACK_SECRET_KEY || "";
async function ps(method, path, body) {
  try {
    const r = await fetch("https://api.paystack.co" + path, { method, headers: { Authorization: "Bearer " + PK(), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j.status !== false, j };
  } catch (e) { return { ok: false, j: { message: "Payment provider unreachable." } }; }
}

/* ---------- shared domain helpers ---------- */
const CONTACT = /(\+?\d[\d\s().-]{7,}\d)|whats\s*app|telegram|signal|wa\.me|t\.me|instagram|facebook|snap\s*chat|@[a-z0-9_.]{3,}|[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/i;
const CFG0 = { fee_pct: 1.5, confirm_mins: 30, grace_hours: 24, thresh: 500000, disabled: [], pausedPairs: [] };
async function audit(e) { const l = await rd("audit", []); l.push({ at: now(), event: e }); await wr("audit", l.slice(-300)); }
async function notify(em, type, title, body, link) {
  if (!em) return;
  const k = "notes-" + em, l = await rd(k, []);
  if (type === "chat") { const i = l.findIndex((x) => x.type === "chat" && !x.read && x.link === link); if (i >= 0) { const n = (l[i].n || 1) + 1; l.splice(i, 1); l.unshift({ id: hex(4), type, title, body: `${n} new messages`, link, at: now(), read: false, n }); await wr(k, l.slice(0, 100)); return; } }
  l.unshift({ id: hex(4), type, title, body, link: link || "", at: now(), read: false }); await wr(k, l.slice(0, 100));
}
async function sys(id, text) { const l = await rd("chat-" + id, []); l.push({ id: hex(4), from: "system", text, at: now() }); await wr("chat-" + id, l.slice(-500)); }
async function tradeMail(em, s, x) { if (!em) return; const r = await email(em, s, x); await audit(`Email to ${em}: ${s} (${r.sent ? "sent" : "not-sent"})`); }

async function getRates() {
  let r = await rd("rates", null);
  if (!r || Date.now() - Date.parse(r.at) > 30 * 60 * 1000) {
    try {
      const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 6000);
      const x = await fetch("https://open.er-api.com/v6/latest/USD", { signal: ac.signal }); clearTimeout(tm);
      const j = await x.json();
      if (j && j.result === "success" && j.rates && j.rates.NGN > 0) { r = { at: now(), source: "open.er-api.com", perUSD: j.rates }; await wr("rates", r); }
    } catch { /* keep last good rates */ }
  }
  return r;
}
async function ngnValue(amount, ccy, o) {
  if (ccy === "NGN") return amount;
  if (o && o.want === "NGN" && o.rate > 0) return amount * o.rate;
  const r = await getRates(); if (!r || !r.perUSD[ccy] || !r.perUSD.NGN) return null;
  return (amount / r.perUSD[ccy]) * r.perUSD.NGN;
}

const akey = (em) => "acct-" + encodeURIComponent(em);
async function getAcct(em) { return (await rd(akey(em), null)) || { email: em, available: 0, locked: 0, bank: null, dva: null }; }
const saveAcct = (a) => wr(akey(a.email), a);
async function ledger(kind, trade, amount, ccy, note) { const l = await rd("ledger", []); l.push({ id: "evt_" + hex(6), kind, trade: trade || null, amount, ccy: ccy || "NGN", note: note || "", at: now() }); await wr("ledger", l.slice(-2000)); }

/* Send money to a user's saved bank account. If it cannot be sent it goes to their free balance. */
async function payout(em, ref, amount, trade) {
  amount = money(amount); if (!(amount > 0)) return { status: "none" };
  const list = await rd("payouts", []);
  let p = list.find((x) => x.ref === ref);
  if (!p) { p = { ref, email: em, amount, trade: trade || null, status: "queued", at: now() }; list.push(p); }
  if (["pending", "success", "pending_approval", "failed"].includes(p.status)) { await wr("payouts", list); return p; }
  const cfg = await rd("config", CFG0);
  if (amount > Number(cfg.thresh || 500000) && !p.approved) { p.status = "pending_approval"; await wr("payouts", list); await notify(em, "payment", "Payout waiting for approval", `₦${amount.toLocaleString()} is waiting for a second team approval.`, "bond.html"); return p; }
  const a = await getAcct(em); let ok = false;
  if (PK() && a.bank && a.bank.recipient_code) {
    const r = await ps("POST", "/transfer", { source: "balance", amount: Math.round(amount * 100), recipient: a.bank.recipient_code, reference: ref, reason: "Trex payout" });
    ok = r.ok; if (!ok) p.note = r.j.message || "transfer failed";
  } else p.note = "no payout account";
  if (ok) { p.status = "pending"; await notify(em, "payment", "Payout on its way", `₦${amount.toLocaleString()} is being sent to your bank account.`, "bond.html"); }
  else { p.status = "failed"; a.available = money(a.available + amount); await saveAcct(a); await notify(em, "payment", "Payout kept in your balance", `₦${amount.toLocaleString()} could not be sent to a bank yet, so it is in your free balance. Add or check your payout account, then withdraw.`, "bond.html"); }
  await wr("payouts", list); return p;
}
async function settleBond(t, mode, fee) {
  if (!t.bond_ngn || !t.bond_locked || t.bond_settled || !t.vendor_email) return;
  const a = await getAcct(t.vendor_email), b = t.bond_ngn;
  a.locked = Math.max(money(a.locked - b), 0);
  let back = 0, comp = 0;
  if (mode === "return") back = Math.max(money(b - (fee || 0)), 0);
  if (mode === "refund") a.available = money(a.available + b);
  if (mode === "partial") { back = money(b / 2); comp = money(b - back); }
  if (mode === "forfeit") comp = b;
  await saveAcct(a); t.bond_settled = true;
  if (fee && mode === "return") await ledger("fee", t.id, fee, "NGN", "Platform fee (non-refundable)");
  if (comp > 0) await ledger("forfeit", t.id, comp, "NGN", "Compensation to customer");
  if (back > 0) await payout(t.vendor_email, ("bond-" + t.id).toLowerCase(), back, t.id);
  if (comp > 0) { await payout(t.customer_email, ("comp-" + t.id).toLowerCase(), comp, t.id); await notify(t.customer_email, "payment", "Compensation from the vendor's bond", `₦${comp.toLocaleString()} is being paid to you.`, "dashboard.html"); }
}
async function lockPending(em) {
  const trades = await rd("trades", []); let ch = false;
  for (const t of trades.filter((x) => x.vendor_email === em && x.state === "awaiting_bond").sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const a = await getAcct(em); if (a.available < t.bond_ngn) continue;
    a.available = money(a.available - t.bond_ngn); a.locked = money(a.locked + t.bond_ngn); await saveAcct(a);
    t.bond_locked = true; t.state = "opened"; t.updated_at = now(); ch = true;
    await ledger("lock", t.id, t.bond_ngn, "NGN", "Bond locked");
    await sys(t.id, "Vendor bond received ✓ — customer, you can now send your payment.");
    await notify(t.customer_email, "trade", "Ready for your payment", `The vendor secured the bond for ${t.id}. Send your payment now.`, "trade.html?open=" + t.id);
    await notify(t.vendor_email, "trade", "Bond received", `Trade ${t.id} has started.`, "vendor-dashboard.html");
    await tradeMail(t.customer_email, `Trade ${t.id} is ready for payment`, "The vendor secured the bond. Open the trade and send your payment.");
  }
  if (ch) await wr("trades", trades);
  return ch;
}
async function finishTrade(t, who) {
  t.state = "completed"; t.completed_at = now(); t.updated_at = now();
  const cfg = await rd("config", CFG0);
  const val = t.bond_ngn ? t.bond_ngn * 2 : 0, fee = money(val * (Number(cfg.fee_pct) || 0) / 100);
  await settleBond(t, "return", fee);
  await sys(t.id, who === "auto" ? "Trade completed automatically — the customer did not respond in time ✓" : "Customer confirmed receipt. Trade complete ✓");
  await notify(t.customer_email, "trade", "Trade completed", `${t.id} is complete.`, "trade.html?open=" + t.id);
  await notify(t.vendor_email, "trade", "Trade completed", `${t.id} is complete. Your bond is being returned.`, "vendor-dashboard.html");
  await tradeMail(t.customer_email, `Receipt ${t.id} — trade complete`, `You received ${t.amount} ${t.provide} at ${t.rate} ${t.want} per ${t.provide}. Ref ${t.id}.`);
}
async function autoComplete(trades) {
  const cfg = await rd("config", CFG0), ms = (Number(cfg.grace_hours) || 24) * 3600e3; let ch = false;
  for (const t of trades) if (t.state === "delivery_sent" && Date.now() - Date.parse(t.updated_at || t.created_at) > ms) { await finishTrade(t, "auto"); ch = true; }
  if (ch) await wr("trades", trades);
}

/* ---------- profiles and vendor reputation ---------- */
async function profileOf(em) { return (await rd("profile-" + em, null)) || {}; }
function pubUser(u, p) { return { uid: u.uid, name: p.display || u.name, avatar: p.avatar ? "/api/avatar/" + u.uid : null, bio: p.bio || "", pledge: p.pledge || "", langs: p.langs || "", country: u.country || null, since: u.created }; }
function vendorStats(em, trades, ratings) {
  const done = trades.filter((t) => t.vendor_email === em && t.state === "completed").length;
  const disp = trades.filter((t) => t.vendor_email === em && ["disputed", "resolved"].includes(t.state)).length;
  const rs = ratings.filter((r) => r.vendor === em);
  return { completed: done, disputes: disp, rating: rs.length ? Math.round((rs.reduce((s, r) => s + Number(r.rating), 0) / rs.length) * 10) / 10 : null, rated: rs.length };
}
async function walletOf(me, trades) {
  const cur = {}, add = (c) => (cur[c] ||= { code: c, received: 0, sent: 0, open: 0, trades: 0 });
  for (const t of trades) {
    const isC = t.customer_email === me, isV = t.vendor_email === me; if (!isC && !isV) continue;
    if (["cancelled"].includes(t.state)) continue;
    const pay = money(t.amount * t.rate), a = add(t.provide), b = add(t.want);
    a.trades++; b.trades++;
    if (t.state === "completed") { if (isC) { a.received += t.amount; b.sent += pay; } else { b.received += pay; a.sent += t.amount; } }
    else if (t.state !== "resolved") { a.open++; b.open++; }
  }
  Object.values(cur).forEach((c) => { c.received = money(c.received); c.sent = money(c.sent); c.net = money(c.received - c.sent); });
  return Object.values(cur);
}

/* ---------- routes ---------- */
const norm = (x) => String(x || "").trim().toLowerCase();
const isEmail = (x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x) && x.length <= 120;
const liveOK = async (em) => { const l = await rd("live-" + em, null); return !!l && l.status === "verified"; };
const BANKS = () => [...new Set([process.env.PAYSTACK_BANK || "access-bank", "wema-bank", "titan-paystack"])];

async function sendCode(em, purpose) {
  const o = (await rd("otp", [])), prev = o.find((x) => x.target === em);
  if (prev && Date.now() - (prev.sent || 0) < 45000) return err("Please wait a moment before asking for another code.", 429);
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const n = o.filter((x) => x.target !== em && x.exp > Date.now() / 1000); n.push({ target: em, code, purpose, exp: Math.floor(Date.now() / 1000) + 600, attempts: 0, sent: Date.now() });
  await wr("otp", n);
  const r = await email(em, purpose === "reset" ? "Reset your Trex password" : "Verify your Trex email", `Your Trex code is ${code}. It expires in 10 minutes. If you didn't ask for this, ignore this email.`);
  await audit(`Code (${purpose}) for ${em}: ${r.sent ? "sent" : "NOT sent"}`);
  if (r.sent) return out({ ok: true, sent: true, expires_in: 600 });
  return err(r.reason === "no-key" ? "Email sending isn't set up yet. Please contact support." : "We couldn't send the email. Check the address and try again.", r.reason === "no-key" ? 503 : 502);
}
async function meInfo(em) {
  const u = await U(em), p = await profileOf(em), lv = await rd("live-" + em, null), nt = await rd("notes-" + em, []);
  return { email: em, ...pubUser(u, p), admin: isAdmin(em), vendor: !!u.vendor, live: lv ? lv.status : "none", unread: nt.filter((x) => !x.read).length, display_ccy: p.display_ccy || null, hide_balances: !!p.hide_balances, phone: u.phone || null };
}

async function handle(req) {
  const url = new URL(req.url), parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean), route = parts[0], M = req.method;
  let body = {}, raw = "";
  if (M === "POST") { raw = await req.text(); try { body = JSON.parse(raw); } catch { body = {}; } }
  const me = await authOf(req);
  const needAuth = () => (me ? null : err("Please sign in first.", 401));
  const needAdmin = () => (!me ? err("Please sign in first.", 401) : isAdmin(me) ? null : err("Admin access only.", 403));
  let e1;
  try {
    /* ----- public ----- */
    if (M === "GET" && route === "health") {
      const c = await pg().catch(() => null);
      return out({ ok: true, service: "trex-api", time: now(), database: process.env.DATABASE_URL ? "postgres" : "blobs", auth: (await ba()) ? "better-auth" : "built-in", auth_note: _baErr,
        email: process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD ? "gmail" : process.env.RESEND_API_KEY ? "resend" : "not-set-up", email_error: _mailErr, paystack: !!PK(), admins: (process.env.ADMIN_EMAILS || "").split(",").filter((x) => x.trim()).length });
    }
    if (M === "GET" && route === "rates") {
      const r = await getRates(); if (!r) return err("Live rates unavailable right now.", 503);
      return out({ ok: true, at: r.at, source: r.source, stale: Date.now() - Date.parse(r.at) > 30 * 60 * 1000, perUSD: r.perUSD });
    }
    if (M === "GET" && route === "config") { const c = await rd("config", CFG0); return out({ ok: true, config: { fee_pct: c.fee_pct, confirm_mins: c.confirm_mins, grace_hours: c.grace_hours, disabled: c.disabled || [], pausedPairs: c.pausedPairs || [] } }); }
    if (M === "GET" && route === "avatar" && parts[1]) {
      const em = await rd("uid-" + parts[1], null), p = em ? await profileOf(em) : {};
      const m = /^data:image\/jpeg;base64,(.+)$/.exec(p.avatar || ""); if (!m) return new Response("", { status: 404 });
      return new Response(Buffer.from(m[1], "base64"), { status: 200, headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=300" } });
    }

    /* ----- account: sign up, verify, login, reset ----- */
    if (M === "POST" && route === "signup") {
      const em = norm(body.email), name = String(body.name || "").trim().slice(0, 60), cc = String(body.country || "").trim().slice(0, 2).toUpperCase();
      if (!isEmail(em)) return err("Enter a valid email address.");
      if (name.length < 2) return err("Enter your full name.");
      if (cc.length !== 2) return err("Choose your country.");
      if (!pwOK(body.password)) return err("Your password needs at least 8 characters with a letter and a number.");
      let u = await U(em);
      if (u && u.verified) return err("An account with this email already exists. Please sign in.", 409, { exists: true });
      const first = !u; u = u || { email: em, uid: hex(6).toLowerCase(), created: now() };
      Object.assign(u, { name, country: cc, pw: await hashPw(body.password), verified: false, bapw: true, tokv: u.tokv || 0 });
      await wr("user-" + em, u); await wr("uid-" + u.uid, em);
      if (first) { const ul = await rd("userlist", []); ul.push(em); await wr("userlist", ul); }
      const B = await ba();
      if (B) {
        try { await B.api.signUpEmail({ body: { email: em, password: body.password, name } }); const c = await pg(); if (c) await c.query('delete from "session" where "userId" in (select id from "user" where email=$1)', [em]); }
        catch (e) { _baErr = String((e && e.message) || e).slice(0, 200); u.bapw = false; await wr("user-" + em, u); try { const c = await pg(); if (c) await c.query('update "account" set password=null where "userId" in (select id from "user" where email=$1)', [em]); } catch { /* ignore */ } }
      }
      return sendCode(em, "verify");
    }
    if (M === "POST" && route === "resend") {
      const em = norm(body.email), u = await U(em); if (!u || u.verified) return out({ ok: true });
      return sendCode(em, "verify");
    }
    if (M === "POST" && route === "verify") {
      const em = norm(body.email), o = await rd("otp", []), rec = o.find((x) => x.target === em && x.purpose === "verify");
      if (!rec || Date.now() / 1000 > rec.exp) return err("That code has expired. Request a new one.");
      if (rec.attempts >= 5) return err("Too many tries. Request a new code.");
      if (String(body.code) !== rec.code) { rec.attempts++; await wr("otp", o); return err("That code doesn't match. Check and try again."); }
      await wr("otp", o.filter((x) => x !== rec));
      const u = await U(em); if (!u) return err("Account not found.", 404);
      u.verified = true; await wr("user-" + em, u);
      try { const c = await pg(); if (c) await c.query('update "user" set "emailVerified"=true where email=$1', [em]); } catch { /* sync is best effort */ }
      await audit(`Email verified ${em}`);
      return out({ ok: true });
    }
    if (M === "POST" && route === "login") {
      const em = norm(body.email), pw = String(body.password || ""), bad = () => err("Incorrect email or password.", 401);
      const lk = (await rd("lock-" + em, null)) || { n: 0, until: 0 };
      if (lk.until > Date.now()) return err("Too many wrong attempts. Try again in a few minutes, or reset your password.", 429);
      const u = await U(em);
      if (!u || !pw) { if (u) { lk.n++; await wr("lock-" + em, lk); } return bad(); }
      let engine = null, token = null; const B = await ba();
      if (B && u.bapw !== false) {
        try {
          const r = await B.api.signInEmail({ body: { email: em, password: pw }, returnHeaders: true });
          const cand = (r && r.response && r.response.token) || (r && r.token) || (r && r.headers && r.headers.get && r.headers.get("set-auth-token")) || null;
          if (cand) { const raw0 = decodeURIComponent(String(cand)).split(".")[0]; if ((await sessionEmail(raw0)) === em) { token = raw0; engine = "better-auth"; } else _baErr = "Better Auth returned a session the server could not validate."; }
        } catch (e) { if (!/invalid|incorrect|credential/i.test(String((e && e.message) || e))) _baErr = String((e && e.message) || e).slice(0, 200); }
      }
      if (!token) { if (await checkPw(pw, u.pw)) { token = await mkToken(em, u.tokv || 0); engine = "built-in"; } }
      if (!token) { lk.n++; if (lk.n >= 6) { lk.until = Date.now() + 15 * 60e3; lk.n = 0; } await wr("lock-" + em, lk); return bad(); }
      if (!u.verified) return err("Please verify your email first.", 403, { unverified: true, email: em });
      if (u.suspended) return err("This account is suspended. Contact support.", 403);
      await wr("lock-" + em, { n: 0, until: 0 });
      await audit(`Login ${em} (${engine})`); await notify(em, "security", "New sign-in", "Your account was just signed in. If this wasn't you, reset your password.", "settings.html");
      return out({ ok: true, token, engine, me: await meInfo(em) }, 200, { "Set-Cookie": cookie(token) });
    }
    if (M === "POST" && route === "reset" && parts[1] === "request") {
      const em = norm(body.email), u = await U(em); if (!u || !u.verified) return out({ ok: true, sent: true });
      return sendCode(em, "reset");
    }
    if (M === "POST" && route === "reset" && parts[1] === "confirm") {
      const em = norm(body.email), o = await rd("otp", []), rec = o.find((x) => x.target === em && x.purpose === "reset");
      if (!pwOK(body.password)) return err("Your password needs at least 8 characters with a letter and a number.");
      if (!rec || Date.now() / 1000 > rec.exp) return err("That code has expired. Request a new one.");
      if (rec.attempts >= 5) return err("Too many tries. Request a new code.");
      if (String(body.code) !== rec.code) { rec.attempts++; await wr("otp", o); return err("That code doesn't match. Check and try again."); }
      await wr("otp", o.filter((x) => x !== rec));
      const u = await U(em); if (!u) return err("Account not found.", 404);
      u.pw = await hashPw(body.password); u.bapw = false; u.tokv = (u.tokv || 0) + 1; await wr("user-" + em, u); await wr("lock-" + em, { n: 0, until: 0 });
      try { const c = await pg(); if (c) { await c.query('update "account" set password=null where "userId" in (select id from "user" where email=$1)', [em]); await c.query('delete from "session" where "userId" in (select id from "user" where email=$1)', [em]); } } catch { /* ignore */ }
      await audit(`Password reset ${em}`); await notify(em, "security", "Password changed", "Your password was reset. All other devices were signed out.", "settings.html");
      return out({ ok: true });
    }

    /* ----- Paystack webhook (signature-checked, no login) ----- */
    if (route === "paystack" && M === "POST") {
      const sig = req.headers.get("x-paystack-signature") || "", good = PK() ? crypto.createHmac("sha512", PK()).update(raw).digest("hex") : "";
      if (!good || sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return err("Bad signature.", 401);
      const ev = body.event, d = body.data || {};
      if (ev === "charge.success" && d.channel === "dedicated_nuban" && (d.currency || "NGN") === "NGN") {
        const refs = await rd("refs", {}), rid = "chg-" + (d.reference || d.id), em = norm(d.customer && d.customer.email);
        if (!refs[rid] && em) {
          const a = await getAcct(em), amt = money(Number(d.amount) / 100);
          a.available = money(a.available + amt); await saveAcct(a); refs[rid] = 1; await wr("refs", refs);
          await ledger("topup", null, amt, "NGN", "Bond deposit"); await audit(`Deposit ${amt} NGN for ${em}`);
          await notify(em, "payment", "Deposit received", `₦${amt.toLocaleString()} was added to your balance.`, "bond.html");
          await lockPending(em);
        }
      } else if (ev === "dedicatedaccount.assign.success") {
        const em = norm(d.customer && d.customer.email), da = d.dedicated_account || {};
        if (em && da.account_number) { const a = await getAcct(em); a.dva = { account_number: da.account_number, account_name: da.account_name, bank: da.bank && da.bank.name }; await saveAcct(a); await notify(em, "payment", "Deposit account ready", `Your deposit account number is ${da.account_number}.`, "bond.html"); }
      } else if (ev === "transfer.success" || ev === "transfer.failed" || ev === "transfer.reversed") {
        const list = await rd("payouts", []), p = list.find((x) => x.ref === d.reference);
        if (p && p.status === "pending") {
          if (ev === "transfer.success") { p.status = "success"; p.done = now(); await wr("payouts", list); await ledger("payout", p.trade, p.amount, "NGN", p.ref); await notify(p.email, "payment", "Payout sent", `₦${p.amount.toLocaleString()} arrived at your bank.`, "bond.html"); }
          else { p.status = "failed"; await wr("payouts", list); const a = await getAcct(p.email); a.available = money(a.available + p.amount); await saveAcct(a); await notify(p.email, "payment", "Payout failed", `₦${p.amount.toLocaleString()} was returned to your free balance.`, "bond.html"); }
          await audit(`Payout ${p.ref} ${p.status}`);
        }
      }
      return out({ ok: true });
    }

    /* ----- everything below needs a signed-in user ----- */
    if ((e1 = needAuth())) return e1;
    const meU = await U(me), meP = await profileOf(me);
    const needLive = async () => ((await liveOK(me)) ? null : err("Complete your face check first (Settings → Security).", 403, { need_live: true }));
    const needVendor = () => (meU.vendor ? null : err("This is for vendors. Open “Become a vendor” to start.", 403, { need_vendor: true }));

    if (M === "GET" && route === "me") return out({ ok: true, me: await meInfo(me) });
    if (M === "POST" && route === "signout") {
      try {
        const c = await pg(), raw0 = decodeURIComponent((req.headers.get("authorization") || "").replace(/^Bearer /, "")).split(".")[0];
        if (body.all) { meU.tokv = (meU.tokv || 0) + 1; await wr("user-" + me, meU); if (c) await c.query('delete from "session" where "userId" in (select id from "user" where email=$1)', [me]); }
        else if (c && raw0) await c.query('delete from "session" where token = $1', [raw0]);
      } catch { /* token simply expires */ }
      return out({ ok: true }, 200, { "Set-Cookie": "trex_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" });
    }

    if (route === "profile") {
      if (parts[1] === "public" && M === "GET") {
        const em = await rd("uid-" + url.searchParams.get("uid"), null); if (!em) return err("Profile not found.", 404);
        const u = await U(em), p = await profileOf(em), vs = vendorStats(em, await rd("trades", []), await rd("ratings", []));
        return out({ ok: true, profile: { ...pubUser(u, p), vendor: !!u.vendor, ...vs } });
      }
      if (M === "GET") return out({ ok: true, profile: { ...(await meInfo(me)), display: meP.display || meU.name, bio: meP.bio || "", pledge: meP.pledge || "", langs: meP.langs || "" } });
      const p = meP;
      if (body.display !== undefined) { const d = String(body.display).trim(); if (d.length < 2 || d.length > 40) return err("Display name must be 2–40 characters."); p.display = d; }
      if (body.bio !== undefined) p.bio = String(body.bio).slice(0, 200);
      if (body.pledge !== undefined) p.pledge = String(body.pledge).slice(0, 30);
      if (body.langs !== undefined) p.langs = String(body.langs).slice(0, 60);
      if (body.display_ccy !== undefined) p.display_ccy = String(body.display_ccy).toUpperCase().slice(0, 3);
      if (body.hide_balances !== undefined) p.hide_balances = !!body.hide_balances;
      if (body.avatar) { if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(body.avatar) || body.avatar.length > 90000) return err("That picture is too large. Choose a smaller one."); p.avatar = body.avatar; }
      if (body.remove_avatar) delete p.avatar;
      if (body.country) {
        const cc = String(body.country).toUpperCase().slice(0, 2);
        if (cc !== meU.country) { const a = await getAcct(me); if (a.locked > 0) return err("Finish your open trades before changing country."); meU.country = cc; await wr("user-" + me, meU); }
      }
      await wr("profile-" + me, p);
      return out({ ok: true, profile: await meInfo(me) });
    }

    if (M === "POST" && route === "vendor" && parts[1] === "enable") {
      if (meU.vendor) return out({ ok: true, already: true });
      if (!body.accept) return err("Please accept the vendor rules first.");
      if (meU.country !== "NG") return err("Vendor accounts are available in Nigeria only for now, because the bond is held in naira. We'll open more countries soon.", 403);
      const ph = String(body.phone || "").replace(/[\s()-]/g, ""); if (!/^\+?\d{8,15}$/.test(ph)) return err("Enter your phone number (8–15 digits) — your bank deposit account needs it.");
      if ((e1 = await needLive())) return e1;
      meU.vendor = true; meU.phone = ph; await wr("user-" + me, meU); await audit(`Vendor enabled ${me}`);
      await notify(me, "system", "You're now a vendor", "Create your first offer and fund your bond when a trade needs it.", "offers.html");
      return out({ ok: true });
    }

    /* ----- notifications ----- */
    if (route === "notifications") {
      const k = "notes-" + me, l = await rd(k, []);
      if (M === "POST") { l.forEach((x) => { if (body.all || (Array.isArray(body.ids) && body.ids.includes(x.id))) x.read = true; }); await wr(k, l); }
      return out({ ok: true, unread: l.filter((x) => !x.read).length, items: l.slice(0, 50) });
    }

    /* ----- face check ----- */
    if (route === "liveness") {
      const sub = parts[1];
      if (sub === "flags" && M === "GET") { if ((e1 = needAdmin())) return e1; return out({ ok: true, flags: (await rd("liveflags", [])).filter((f) => !f.cleared) }); }
      if (sub === "clear" && M === "POST") {
        if ((e1 = needAdmin())) return e1;
        const em = norm(body.email), u = await rd("live-" + em, null); if (!u) return err("No face check found for that email.", 404);
        u.status = "verified"; await wr("live-" + em, u);
        const fl = await rd("liveflags", []); fl.forEach((x) => { if (x.email === em) x.cleared = true; }); await wr("liveflags", fl); await audit(`Face check cleared for ${em} by ${me}`);
        await notify(em, "security", "Face check approved", "Your account is fully verified.", "dashboard.html"); return out({ ok: true });
      }
      if (sub === "me" && M === "GET") { const u = await rd("live-" + me, null); return out({ ok: true, status: u ? u.status : "none" }); }
      if (M === "POST") {
        const fr = Array.isArray(body.frames) ? body.frames : [], fb = !!body.fallback;
        if (fr.length !== 3 || fr.some((x) => !/^data:image\/jpeg;base64,/.test(String(x)) || String(x).length > 120000)) return err("Face check images were not accepted. Please try again.");
        const desc = Array.isArray(body.desc) && body.desc.length === 128 && body.desc.every((x) => Number.isFinite(x)) ? body.desc : null;
        if (!desc && !/^[0-9a-f]{16}$/.test(String(body.hash || ""))) return err("Face check failed. Please try again.");
        const motion = Number(body.motion) || 0;
        if (!fb && motion < 3) return err("We couldn't see you move. Try again in good light and follow each instruction.");
        const hashes = (await rd("livehashes", [])).filter((h) => h.email !== me), descs = (await rd("livedescs", [])).filter((h) => h.email !== me);
        const pop = (x) => x.toString(2).split("1").length - 1;
        let dup = null;
        if (desc) dup = descs.find((h) => Math.sqrt(h.d.reduce((s, v, i) => s + (v - desc[i]) ** 2, 0)) < 0.45) || null;
        else if (body.hash) { const mine = BigInt("0x" + body.hash); dup = hashes.find((h) => pop(mine ^ BigInt("0x" + h.hash)) <= 3) || null; }
        if (dup) {
          const fl = await rd("liveflags", []); fl.push({ email: me, match: dup.email, at: now() }); await wr("liveflags", fl); await audit(`Duplicate face blocked: ${me} ~ ${dup.email}`);
          return err("This face already belongs to another Trex account. Please sign in to that account. If you think this is a mistake, open a support ticket.", 409, { duplicate: true });
        }
        if (body.hash) { hashes.push({ email: me, hash: body.hash }); await wr("livehashes", hashes); }
        if (desc) { descs.push({ email: me, d: desc }); await wr("livedescs", descs); }
        const status = desc && !fb ? "verified" : "review";
        await wr("live-" + me, { email: me, at: now(), hash: body.hash || null, frames: fr, motion, challenges: body.challenges || [], status, fallback: fb, model: !!desc });
        await audit(`Face check ${status} for ${me}`);
        await notify(me, "security", status === "verified" ? "Face check complete" : "Face check under review", status === "verified" ? "Your account is fully verified." : "Our team will review it shortly.", "dashboard.html");
        return out({ ok: true, status });
      }
    }

    /* ----- offers (vendors only to create) ----- */
    if (route === "offers") {
      let list = await rd("offers", []);
      if (M === "GET") {
        const trades = await rd("trades", []), ratings = await rd("ratings", []), cache = {}, res = [];
        for (const o of list) {
          const mine = o.owner === me;
          if (url.searchParams.get("mine") === "1" ? !mine : !o.live) continue;
          const c = (cache[o.owner] ||= { u: await U(o.owner), p: await profileOf(o.owner) });
          if (!c.u || !c.u.vendor || (c.u.suspended && !mine)) continue;
          const vs = vendorStats(o.owner, trades, ratings), { owner, pay_details, ...pub } = o;
          res.push({ ...pub, mine, pay_details: mine ? pay_details : undefined, vendor: `${c.p.display || c.u.name} • ★${vs.rating == null ? "new" : vs.rating} • ${vs.completed} trades`, vuid: c.u.uid, photo: c.p.avatar ? "/api/avatar/" + c.u.uid : null,
            bio: c.p.bio || "", pledge: c.p.pledge || "", langs: c.p.langs || "", vcountry: c.u.country, tier: vs.completed >= 20 && (vs.rating || 0) >= 4.5 ? "Gold" : "Probation", capacity: o.max });
        }
        return out({ ok: true, offers: res });
      }
      if ((e1 = needVendor())) return e1;
      if ((e1 = await needLive())) return e1;
      if (body.id) {
        const o = list.find((x) => x.id === body.id);
        if (!o || (o.owner !== me && !isAdmin(me))) return err("Offer not found.", 404);
        if (body.delete) { await wr("offers", list.filter((x) => x.id !== body.id)); await audit(`Offer deleted ${body.id}`); return out({ ok: true }); }
        for (const k of ["rate", "min", "max", "methods", "terms", "avail", "live", "pay_details"]) if (body[k] !== undefined && body[k] !== null) o[k] = k === "rate" || k === "min" || k === "max" ? +body[k] : body[k];
        if (!(o.rate > 0) || !(o.max > o.min) || !(o.min > 0)) return err("Check your rate and limits.");
        await wr("offers", list); await audit(`Offer updated ${o.id}`); return out({ ok: true });
      }
      const pd = String(body.pay_details || "").trim().slice(0, 200); if (pd.length < 5) return err("Add your payment details (bank, account number and account name) so customers know where to pay.");
      const pv = String(body.provide || "").toUpperCase(), wn = String(body.want || "").toUpperCase();
      if (!/^[A-Z]{3}$/.test(pv) || !/^[A-Z]{3}$/.test(wn)) return err("Provide and want currencies are required.");
      if (pv === wn) return err("Pick two different currencies.");
      if (!(Number(body.rate) > 0)) return err("Set a rate above zero.");
      if (!(Number(body.min) > 0) || !(Number(body.max) > Number(body.min))) return err("Maximum must be above minimum.");
      const o = { id: "OFR-" + hex(3), owner: me, provide: pv, want: wn, rate: +body.rate, min: +body.min, max: +body.max, country: meU.country,
        methods: Array.isArray(body.methods) && body.methods.length ? body.methods.slice(0, 5).map((x) => String(x).slice(0, 40)) : ["Bank transfer"], terms: String(body.terms || "").slice(0, 200), pay_details: pd, avail: body.avail || "Online now", live: true, created_at: now() };
      list.push(o); await wr("offers", list); await audit(`Offer published ${o.id} ${pv}->${wn}`);
      return out({ ok: true, offer: { id: o.id } });
    }

    /* ----- trades ----- */
    if (M === "POST" && route === "trades") {
      if ((e1 = await needLive())) return e1;
      return idemRun(req, body, me, async (b) => {
        const offers = await rd("offers", []), o = offers.find((x) => x.id === b.offer_id && x.live);
        if (!o) return { ok: false, error: "Offer unavailable." };
        const ow = await U(o.owner); if (!ow || !ow.vendor || ow.suspended) return { ok: false, error: "This vendor is not available right now." };
        if (o.owner === me) return { ok: false, error: "You can't trade against your own offer." };
        const amt = money(b.amount);
        if (!(amt > 0)) return { ok: false, error: "Enter an amount above zero." };
        if (b.sell !== o.want || b.recv !== o.provide) return { ok: false, error: "That offer doesn't match your trade." };
        const cfg = await rd("config", CFG0);
        if ((cfg.disabled || []).includes(o.provide) || (cfg.disabled || []).includes(o.want) || (cfg.pausedPairs || []).some((p) => p === o.provide + "-" + o.want || p === o.want + "-" + o.provide)) return { ok: false, error: "This market is paused right now." };
        if (amt > o.max) return { ok: false, error: `Above this offer's maximum (${o.max} ${o.provide}).` };
        if (amt < o.min) return { ok: false, error: `Below this offer's minimum (${o.min} ${o.provide}).` };
        const rd0 = String(b.receive_details || "").trim().slice(0, 200); if (rd0.length < 5) return { ok: false, error: `Tell the vendor where to send your ${o.provide} (bank/account or wallet details).` };
        let bondN = 0;
        if (PK()) { const v = await ngnValue(amt, o.provide, o); if (v == null) return { ok: false, error: "Live rates are unavailable. Try again in a minute." }; bondN = money(v * 0.5); }
        const p = await profileOf(o.owner), cp = meP;
        const t = { id: "TXN-" + hex(4), offer_id: o.id, sell: o.want, recv: o.provide, provide: o.provide, want: o.want, amount: amt, rate: o.rate, fee_pct: cfg.fee_pct || 1.5, customer_email: me, vendor_email: o.owner,
          bond_ngn: bondN, pay_details: o.pay_details || "", receive_details: rd0, state: "awaiting_vendor", proof: null, vendor: p.display || ow.name, customer: cp.display || meU.name, created_at: now(), updated_at: now() };
        const trades = await rd("trades", []); trades.push(t); await wr("trades", trades);
        await sys(t.id, "Trade opened. Waiting for the vendor to accept.");
        await notify(o.owner, "trade", "New trade request", `${t.customer} wants ${amt} ${o.provide}. Accept or decline.`, "vendor-dashboard.html");
        await notify(me, "trade", "Trade request sent", `Waiting for ${t.vendor} to accept ${t.id}.`, "trade.html?open=" + t.id);
        await tradeMail(o.owner, "New Trex order — accept it", `Trade ${t.id}: a customer wants ${amt} ${o.provide}. Open your vendor dashboard to accept or decline.`);
        await audit(`Trade opened ${t.id}`);
        return { ok: true, trade: await pubT(t, me) };
      });
    }
    if (M === "GET" && route === "trades") {
      const all = await rd("trades", []); await autoComplete(all);
      const mine = all.filter((t) => isAdmin(me) || t.customer_email === me || t.vendor_email === me);
      return out({ ok: true, trades: await Promise.all(mine.map((t) => pubT(t, me))) });
    }
    if (M === "POST" && route === "trade_action") return idemRun(req, body, me, async (b) => {
      const trades = await rd("trades", []), t = trades.find((x) => x.id === b.id);
      if (!t) return { ok: false, error: "Trade not found." };
      const isV = me === t.vendor_email, isC = me === t.customer_email;
      if (!isV && !isC) return { ok: false, error: "This isn't your trade." };
      const a = String(b.action);
      const roleOK = { accept: isV, decline: isV, pay: isC, cancel: true, complete: isC, confirm: isV, deliver: isV, dispute: true }[a];
      const allowed = { awaiting_vendor: ["accept", "decline", "cancel"], awaiting_bond: ["decline", "cancel"], opened: ["pay", "cancel"], payment_sent: ["confirm", "dispute"], payment_confirmed: ["deliver", "dispute"], delivery_sent: ["complete", "dispute"] };
      if (!(allowed[t.state] || []).includes(a)) return { ok: false, error: `Cannot ${a} a ${t.state.replace(/_/g, " ")} trade.` };
      if (!roleOK) return { ok: false, error: ["confirm", "deliver", "accept", "decline"].includes(a) ? "Only the vendor can do this step." : "Only the customer can do this step." };
      if (a === "pay" && !String(b.proof || "").trim()) return { ok: false, error: "Attach your payment receipt first." };
      if (a === "deliver" && !String(b.proof || "").trim()) return { ok: false, error: "Attach proof of delivery first." };
      const other = isV ? t.customer_email : t.vendor_email;
      if (a === "accept") {
        if ((await rd("live-" + me, null))?.status !== "verified") return { ok: false, error: "Complete your face check first." };
        if (PK() && t.bond_ngn) {
          const acc = await getAcct(me);
          if (acc.available >= t.bond_ngn) { acc.available = money(acc.available - t.bond_ngn); acc.locked = money(acc.locked + t.bond_ngn); await saveAcct(acc); t.bond_locked = true; t.state = "opened"; await ledger("lock", t.id, t.bond_ngn, "NGN", "Bond locked"); }
          else t.state = "awaiting_bond";
        } else t.state = "opened";
      } else t.state = { pay: "payment_sent", confirm: "payment_confirmed", deliver: "delivery_sent", complete: "completed", cancel: "cancelled", dispute: "disputed", decline: "cancelled" }[a];
      t.updated_at = now();
      if (a === "pay") t.proof = String(b.proof).slice(0, 200);
      if (a === "deliver") t.delivery_proof = String(b.proof).slice(0, 200);
      const SM = { accept: t.state === "awaiting_bond" ? `Vendor accepted and must deposit a ₦${t.bond_ngn.toLocaleString()} bond. Please wait.` : "Vendor accepted. Customer, you can now send your payment.", decline: "Vendor declined this trade.", cancel: "Trade cancelled.", pay: "Customer marked payment as sent.", confirm: "Vendor confirmed the payment.", deliver: "Vendor says the currency was sent.", dispute: "A problem was reported. Trex is reviewing this trade." };
      if (a === "complete") await finishTrade(t, "customer");
      else {
        await sys(t.id, SM[a]);
        if (t.state === "cancelled") await settleBond(t, "refund");
        if (t.state === "disputed") { const d = await rd("disputes", []); d.push({ id: "DSP-" + hex(3), trade: t.id, pair: `${t.sell}-${t.recv}`, amount: t.amount, cur: t.provide, vendor: t.vendor, customer: t.customer, proof: t.proof, delivery_proof: t.delivery_proof, rate: t.rate, bond_ngn: t.bond_ngn, state: "OPEN", at: now(), opened_by: isV ? "vendor" : "customer" }); await wr("disputes", d); }
        const NT = { accept: ["trade", t.state === "awaiting_bond" ? "Vendor accepted" : "Vendor accepted — pay now", t.state === "awaiting_bond" ? "The vendor is securing the bond. We'll tell you when you can pay." : `Send your payment for ${t.id}.`], decline: ["trade", "Vendor declined", `${t.id} was declined.`], cancel: ["trade", "Trade cancelled", `${t.id} was cancelled.`], pay: ["payment", "Payment marked as sent", `${t.id}: confirm that you received it.`], confirm: ["payment", "Payment confirmed", `The vendor confirmed your payment for ${t.id}.`], deliver: ["trade", "Currency sent", `${t.id}: please confirm that you received it.`], dispute: ["trade", "Trade under review", `${t.id} was reported and is being reviewed.`] };
        await notify(other, ...NT[a], isV ? "trade.html?open=" + t.id : "vendor-dashboard.html");
        if (["decline", "cancel", "deliver", "dispute", "pay"].includes(a)) await tradeMail(other, `Trade ${t.id}: ${NT[a][1]}`, NT[a][2]);
      }
      await wr("trades", trades); await audit(`Trade ${t.id} → ${t.state}`);
      return { ok: true, trade: await pubT(t, me) };
    });

    /* ----- chat ----- */
    if (route === "chat") {
      const tid = M === "GET" ? url.searchParams.get("trade") : body.trade, trades = await rd("trades", []), t = trades.find((x) => x.id === tid);
      if (!t) return err("Trade not found.", 404);
      const isV = me === t.vendor_email, isC = me === t.customer_email, adm = isAdmin(me) && ["disputed", "resolved"].includes(t.state);
      if (!isV && !isC && !adm) return err("This chat is private to the two traders.", 403);
      const role = isV ? "vendor" : isC ? "customer" : "admin", other = role === "vendor" ? "customer" : "vendor", key = "chat-" + tid, rk = "read-" + tid, tk = "typing-" + tid;
      const list = await rd(key, []), rr = await rd(rk, {});
      const oEm = other === "vendor" ? t.vendor_email : t.customer_email;
      if (M === "GET") {
        const since = url.searchParams.get("since") || "";
        if (role !== "admin" && (!rr[role] || Date.now() - Date.parse(rr[role]) > 4000)) { rr[role] = now(); await wr(rk, rr); }
        const ty = await rd(tk, {}), ou = await U(oEm), op = await profileOf(oEm);
        return out({ ok: true, role, state: t.state, messages: since ? list.filter((m) => m.at > since) : list, other_read: rr[other] || null, other_typing: !!ty[other] && Date.now() - Date.parse(ty[other]) < 6000,
          other: ou ? { name: op.display || ou.name, avatar: op.avatar ? "/api/avatar/" + ou.uid : null, online: !!rr[other] && Date.now() - Date.parse(rr[other]) < 20000 } : null, server_time: now() });
      }
      if (role === "admin") return err("Admins can read this chat but not post in it.", 403);
      if (body.typing) { const ty = await rd(tk, {}); ty[role] = now(); await wr(tk, ty); return out({ ok: true }); }
      const text = String(body.text || "").trim().slice(0, 1000), img = body.image ? String(body.image) : "";
      if (!text && !img) return err("Type a message first.");
      if (img && (!/^data:image\/(jpeg|png|webp);base64,/.test(img) || img.length > 450000)) return err("That image is too large or not supported.");
      if (text && CONTACT.test(text)) { list.push({ id: hex(4), from: "system", text: "A message was held: sharing phone numbers or other apps is not allowed. Trades taken off Trex lose bond protection.", at: now() }); await wr(key, list.slice(-500)); return out({ ok: false, held: true, error: "Message held — sharing contact details off Trex removes your bond protection." }); }
      const m = { id: hex(4), from: role, text, at: now() }; if (img) m.img = img;
      list.push(m); await wr(key, list.slice(-500)); rr[role] = m.at; await wr(rk, rr);
      const ty = await rd(tk, {}); delete ty[role]; await wr(tk, ty);
      if (!rr[other] || Date.now() - Date.parse(rr[other]) > 8000) await notify(oEm, "chat", `Message from ${role === "vendor" ? t.vendor : t.customer}`, text ? text.slice(0, 80) : "📷 Photo", (role === "vendor" ? "trade.html" : "vendor-dashboard.html") + "?open=" + tid);
      const quiet = !rr[other] || Date.now() - Date.parse(rr[other]) > 3 * 60e3;
      if (quiet && (!rr["n-" + other] || Date.now() - Date.parse(rr["n-" + other]) > 15 * 60e3)) { rr["n-" + other] = now(); await wr(rk, rr); await email(oEm, `New message on trade ${t.id}`, `You have a new message on Trex trade ${t.id}. Open the trade to reply.`); }
      return out({ ok: true, message: m });
    }

    if (route === "ratings" && M === "POST") {
      const trades = await rd("trades", []), t = trades.find((x) => x.id === body.trade), r = await rd("ratings", []);
      const n = Number(body.rating);
      if (!t || t.customer_email !== me || t.state !== "completed") return err("You can rate a vendor after your completed trade.");
      if (!(n >= 1 && n <= 5)) return err("Pick 1 to 5 stars.");
      if (r.some((x) => x.trade === t.id)) return err("You already rated this trade.");
      r.push({ trade: t.id, rating: Math.round(n), vendor: t.vendor_email, by: me, at: now() }); await wr("ratings", r);
      await notify(t.vendor_email, "trade", "New rating", `A customer rated you ${Math.round(n)}★ for ${t.id}.`, "vendor-dashboard.html"); return out({ ok: true });
    }

    /* ----- wallet, bond & payouts ----- */
    if (M === "GET" && route === "wallet") {
      const all = await rd("trades", []); await autoComplete(all);
      const a = await getAcct(me), pay = (await rd("payouts", [])).filter((p) => p.email === me && p.status === "pending_approval").reduce((s, p) => s + p.amount, 0);
      return out({ ok: true, currencies: await walletOf(me, all), vendor: !!meU.vendor, hide: !!meP.hide_balances, ngn: { available: a.available, locked: a.locked, awaiting: money(pay) }, at: now() });
    }
    if (route === "banks" && M === "GET") {
      let b = await rd("banks", null);
      if ((!b || Date.now() - Date.parse(b.at) > 864e5) && PK()) { const r = await ps("GET", "/bank?country=nigeria&perPage=200&currency=NGN"); if (r.ok && Array.isArray(r.j.data)) { b = { at: now(), list: r.j.data.map((x) => ({ name: x.name, code: x.code })) }; await wr("banks", b); } }
      return out({ ok: true, banks: (b && b.list) || [] });
    }
    if (route === "bond") {
      const sub = parts[1], bondOK = meU.country === "NG";
      if (sub === "pending" && M === "GET") { if ((e1 = needAdmin())) return e1; return out({ ok: true, payouts: (await rd("payouts", [])).filter((p) => p.status === "pending_approval") }); }
      if (sub === "approve" && M === "POST") {
        if ((e1 = needAdmin())) return e1;
        const list = await rd("payouts", []), p = list.find((x) => x.ref === body.ref && x.status === "pending_approval"); if (!p) return err("Nothing to approve.", 404);
        p.approved = true; p.approved_by = me; p.status = "queued"; await wr("payouts", list);
        const r = await payout(p.email, p.ref, p.amount, p.trade); await audit(`Payout ${p.ref} approved by ${me}`); return out({ ok: true, status: r.status });
      }
      const a = await getAcct(me);
      if (sub === "check" && M === "POST") return out({ ok: true, started: await lockPending(me) });
      if (sub === "me" && M === "GET") {
        const mine = (await rd("payouts", [])).filter((p) => p.email === me).slice(-10).reverse();
        return out({ ok: true, configured: !!PK(), bond_currency: "NGN", supported: bondOK, vendor: !!meU.vendor, country: meU.country, available: a.available, locked: a.locked, dva: meU.vendor ? a.dva || null : null,
          bank: a.bank ? { account_name: a.bank.account_name, bank_name: a.bank.bank_name, last4: String(a.bank.account_number).slice(-4) } : null, payouts: mine });
      }
      if (!PK()) return err("Payments aren't switched on yet.", 503);
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
        if ((e1 = needVendor())) return e1;
        if (!bondOK) return err("Bond for your country is coming soon. Bonds are in naira (Nigeria) only for now.", 403);
        if (!a.dva) {
          if (!a.customer_code) {
            const [fn, ...ln] = String(meU.name || "Trex Vendor").trim().split(/\s+/);
            const c = await ps("POST", "/customer", { email: me, first_name: fn || "Trex", last_name: ln.join(" ") || "Vendor", phone: meU.phone });
            if (!c.ok) return err(c.j.message || "Couldn't set up your deposit account.");
            a.customer_code = c.j.data.customer_code;
          }
          let last = "";
          for (const pb of BANKS()) {
            const d = await ps("POST", "/dedicated_account", { customer: a.customer_code, preferred_bank: pb });
            if (d.ok && d.j.data && d.j.data.account_number) { a.dva = { account_number: d.j.data.account_number, account_name: d.j.data.account_name, bank: d.j.data.bank && d.j.data.bank.name }; break; }
            if (d.ok) { a.dva_pending = true; break; }
            last = d.j.message || last;
          }
          await saveAcct(a);
          if (!a.dva && !a.dva_pending) return err(last || "Couldn't create your deposit account.");
        }
        return out({ ok: true, dva: a.dva || null, pending: !a.dva });
      }
      if (sub === "withdraw" && M === "POST") return idemRun(req, body, me, async (b) => {
        const acc = await getAcct(me), amt = money(b.amount);
        if (!(amt > 0) || amt > acc.available) return { ok: false, error: "That exceeds your free balance." };
        if (!acc.bank) return { ok: false, error: "Add your payout account first." };
        acc.available = money(acc.available - amt); await saveAcct(acc);
        const p = await payout(me, "withdraw-" + hex(6).toLowerCase(), amt, null); await audit(`Withdrawal ${amt} NGN ${p.status} for ${me}`);
        return { ok: true, status: p.status };
      });
      return err("Unknown endpoint.", 404);
    }

    /* ----- support tickets ----- */
    if (route === "tickets") {
      const t = await rd("tickets", []);
      if (M === "POST") {
        if (parts[1] === "close") { if ((e1 = needAdmin())) return e1; const x = t.find((y) => y.id === body.id); if (x) { x.status = "closed"; await wr("tickets", t); await notify(x.by, "system", "Support ticket closed", x.title, "settings.html"); } return out({ ok: true }); }
        const title = String(body.title || "").trim().slice(0, 300); if (!title) return err("Describe the issue first.");
        t.push({ id: "TCK-" + hex(3), cat: String(body.cat || "General").slice(0, 30), title, by: me, status: "open", at: now() }); await wr("tickets", t); await audit("Ticket opened"); return out({ ok: true });
      }
      if (url.searchParams.get("all") === "1") { if ((e1 = needAdmin())) return e1; return out({ ok: true, tickets: t }); }
      return out({ ok: true, tickets: t.filter((x) => x.by === me).reverse() });
    }

    /* ----- admin ----- */
    if (route === "admin") {
      if ((e1 = needAdmin())) return e1;
      if (parts[1] === "overview" && M === "GET") {
        const ul = await rd("userlist", []), us = await Promise.all(ul.map((e) => U(e))), trades = await rd("trades", []), cfg = await rd("config", CFG0);
        const by = {}, vol = {}; trades.forEach((t) => { by[t.state] = (by[t.state] || 0) + 1; if (t.state === "completed") vol[t.want] = money((vol[t.want] || 0) + t.amount * t.rate); });
        const rates = await rd("rates", null), pend = (await rd("payouts", [])).filter((p) => p.status === "pending_approval").length;
        return out({ ok: true, users: us.filter((u) => u && u.verified).length, vendors: us.filter((u) => u && u.vendor).length, trades: by, volume: vol, openDisputes: (await rd("disputes", [])).filter((d) => d.state === "OPEN").length, pendingPayouts: pend,
          flagged: (await rd("liveflags", [])).filter((f) => !f.cleared).length, rates_at: rates && rates.at, disabled: cfg.disabled || [] });
      }
      if (parts[1] === "vendors" && M === "GET") {
        const ul = await rd("userlist", []), trades = await rd("trades", []), ratings = await rd("ratings", []), res = [];
        for (const e of ul) { const u = await U(e); if (!u || !u.vendor) continue; const a = await getAcct(e), vs = vendorStats(e, trades, ratings); res.push({ email: e, name: u.name, country: u.country, suspended: !!u.suspended, ...vs, available: a.available, locked: a.locked }); }
        return out({ ok: true, vendors: res });
      }
      if (parts[1] === "vendor" && M === "POST") {
        const em = norm(body.email), u = await U(em); if (!u) return err("User not found.", 404);
        if (body.action === "suspend") u.suspended = true; else if (body.action === "unsuspend") u.suspended = false; else if (body.action === "demote") u.vendor = false; else return err("Unknown action.");
        if (body.action !== "unsuspend") { const l = await rd("offers", []); l.forEach((o) => { if (o.owner === em) o.live = false; }); await wr("offers", l); }
        await wr("user-" + em, u); await audit(`Admin ${me}: ${body.action} ${em}`); await notify(em, "security", body.action === "unsuspend" ? "Account restored" : body.action === "demote" ? "Vendor status removed" : "Account suspended", "Contact support if you have questions.", "settings.html");
        return out({ ok: true });
      }
    }
    if (M === "GET" && route === "disputes") { if ((e1 = needAdmin())) return e1; return out({ ok: true, disputes: await rd("disputes", []) }); }
    if (M === "POST" && route === "resolve") {
      if ((e1 = needAdmin())) return e1;
      return idemRun(req, body, me, async (b) => {
        const ds = await rd("disputes", []), d = ds.find((x) => x.id === b.id);
        if (!d) return { ok: false, error: "Case not found." };
        if (d.state !== "OPEN") return { ok: false, error: "Already resolved." };
        if (!["VENDOR-AT-FAULT", "EXONERATED", "PARTIAL"].includes(b.how)) return { ok: false, error: "Unknown outcome." };
        const cfg = await rd("config", CFG0);
        if (Number(d.bond_ngn) * 2 > Number(cfg.thresh || 500000) && !b.second_approval) return { ok: false, error: "Large amount — second approval required.", need_second: true };
        d.state = "RESOLVED-" + b.how; d.resolved_at = now(); d.resolved_by = me; await wr("disputes", ds);
        const trades = await rd("trades", []), t = trades.find((x) => x.id === d.trade);
        if (t) {
          t.state = "resolved"; t.updated_at = now();
          await settleBond(t, b.how === "VENDOR-AT-FAULT" ? "forfeit" : b.how === "PARTIAL" ? "partial" : "return", 0);
          await wr("trades", trades); await sys(t.id, "Trex reviewed this trade and made a decision.");
          await notify(t.customer_email, "trade", "Review complete", `${t.id}: ${b.how === "VENDOR-AT-FAULT" ? "decided in your favour" : "decision made"}.`, "trade.html?open=" + t.id);
          await notify(t.vendor_email, "trade", "Review complete", `${t.id}: ${b.how === "VENDOR-AT-FAULT" ? "decided against you — bond forfeited" : "decision made"}.`, "vendor-dashboard.html");
          await tradeMail(t.customer_email, `Review complete — trade ${t.id}`, b.how === "VENDOR-AT-FAULT" ? "Decided in your favour. Compensation comes from the vendor's bond." : `Decided: ${b.how}.`);
        }
        await audit(`Dispute ${d.id} resolved ${b.how} by ${me}`);
        return { ok: true, dispute: d };
      });
    }
    if (route === "config" && M === "POST") {
      if ((e1 = needAdmin())) return e1;
      const c = await rd("config", CFG0);
      for (const k of ["fee_pct", "confirm_mins", "grace_hours", "thresh", "disabled", "pausedPairs"]) if (body[k] !== undefined && body[k] !== null) c[k] = body[k];
      await wr("config", c); await audit(`Settings updated by ${me}`); return out({ ok: true, config: c });
    }
    if (M === "GET" && route === "ledger") { if ((e1 = needAdmin())) return e1; return out({ ok: true, ledger: (await rd("ledger", [])).slice(-300) }); }
    if (M === "GET" && route === "audit") { if ((e1 = needAdmin())) return e1; return out({ ok: true, audit: await rd("audit", []) }); }

    if (M === "GET" && route === "authcheck") {
      if ((e1 = needAdmin())) return e1;
      const steps = [], step = (n, okk, note) => steps.push({ step: n, ok: !!okk, note: note || "" });
      const probe = "authcheck+" + hex(3).toLowerCase() + "@trex.invalid", pw = "Probe-" + hex(4) + "9a";
      step("You are signed in as an admin", true, me);
      step("Email sender configured", !!((process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) || process.env.RESEND_API_KEY), "Set GMAIL_USER and GMAIL_APP_PASSWORD");
      try {
        const c = await pg(); step("Postgres connection", !!c, c ? "" : "DATABASE_URL is not set");
        if (c) {
          await c.query('select 1 from "user" limit 1'); await c.query('select 1 from "account" limit 1'); step("Better Auth tables exist", true);
          const B = await ba(); step("Better Auth starts", !!B, B ? "" : _baErr);
          if (B) {
            await B.api.signUpEmail({ body: { email: probe, password: pw, name: "Authcheck" } });
            const r1 = await c.query('select count(*)::int as n from "user" u join "account" a on a."userId"=u.id where u.email=$1 and a.password is not null', [probe]);
            step("Better Auth writes user + password to Postgres", r1.rows[0].n > 0, "user/account rows not found");
            const r = await B.api.signInEmail({ body: { email: probe, password: pw }, returnHeaders: true });
            const cand = (r && r.response && r.response.token) || (r && r.token) || (r && r.headers && r.headers.get && r.headers.get("set-auth-token"));
            step("Better Auth signs a user in", !!cand);
            step("Server accepts the Better Auth session", cand && (await sessionEmail(cand)) === probe, "session lookup failed");
            await c.query('delete from "user" where email = $1', [probe]);
          }
        }
      } catch (e) { step("Unexpected error", false, String((e && e.message) || e).slice(0, 300)); }
      if (PK()) { const b = await ps("GET", "/balance"); step("Paystack key works", b.ok, b.ok ? "" : (b.j.message || "key rejected")); } else step("Paystack key set", false, "Add PAYSTACK_SECRET_KEY");
      return out({ ok: steps.every((x) => x.ok), steps });
    }
    return err("Unknown endpoint.", 404);
  } catch (e) {
    return err("Server error — please retry.", 500);
  }
}

async function pubT(t, me) {
  const isV = me === t.vendor_email, em = isV ? t.customer_email : t.vendor_email, u = await U(em), p = em ? await profileOf(em) : {};
  const { vendor_email, customer_email, pay_details, receive_details, ...r } = t, live = !["awaiting_vendor", "awaiting_bond", "cancelled"].includes(t.state);
  if (isV) { r.pay_details = pay_details; if (live) r.receive_details = receive_details; } else { r.receive_details = receive_details; if (live) r.pay_details = pay_details; }
  return { ...r, role: isV ? "vendor" : "customer", with: u ? { uid: u.uid, name: p.display || u.name, avatar: p.avatar ? "/api/avatar/" + u.uid : null } : null };
}
async function idemRun(req, body, me, fn) {
  const key = req.headers.get("x-idempotency-key") || body.idempotency_key, ik = key ? "idem-" + me + "-" + String(key).slice(0, 80) : null;
  if (ik) { const prev = await rd(ik, null); if (prev) return out(prev); }
  const r = await fn(body);
  if (ik && r && r.ok) await wr(ik, r);
  return out(r);
}

export default async (req) => {
  let c = null;
  try { c = await pg(); } catch (e) { return err("Database unavailable — please retry shortly.", 503); }
  const post = req.method === "POST";
  if (c && post) await c.query("select pg_advisory_lock(727272)");
  try { return await handle(req); }
  finally { if (c && post) await c.query("select pg_advisory_unlock(727272)").catch(() => {}); }
};
