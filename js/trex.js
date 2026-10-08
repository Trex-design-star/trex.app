/* Trex shared library: currencies, countries, rates, quotes, storage helpers. */
(function (root) {
  "use strict";
  var flag = function (cc) {
    if (!cc || cc.length !== 2) return "🏳";
    return String.fromCodePoint(cc.charCodeAt(0) + 127397, cc.charCodeAt(1) + 127397);
  };
  /* code|name|symbol|country|units per 1 USD|popular */
  var RAW = [
    "USD|US Dollar|$|US|1|1","GBP|British Pound|£|GB|0.7835051546|1","EUR|Euro|€|EU|0.9212121212|1","NGN|Nigerian Naira|₦|NG|1520|1",
    "GHS|Ghanaian Cedi|GH₵|GH|15.5|1","KES|Kenyan Shilling|KSh|KE|129|1","ZAR|South African Rand|R|ZA|18.2|1","JPY|Japanese Yen|¥|JP|150|1",
    "CAD|Canadian Dollar|C$|CA|1.37|0","AUD|Australian Dollar|A$|AU|1.52|0","CHF|Swiss Franc|CHF|CH|0.88|0","CNY|Chinese Yuan|CN¥|CN|7.2|0",
    "INR|Indian Rupee|₹|IN|83.2|0","AED|UAE Dirham|د.إ|AE|3.67|0","SAR|Saudi Riyal|﷼|SA|3.75|0","EGP|Egyptian Pound|E£|EG|48.5|0",
    "MAD|Moroccan Dirham|MAD|MA|10|0","TZS|Tanzanian Shilling|TSh|TZ|2600|0","UGX|Ugandan Shilling|USh|UG|3750|0","RWF|Rwandan Franc|RF|RW|1350|0",
    "XOF|West African CFA Franc|CFA|SN|604|0","XAF|Central African CFA Franc|FCFA|CM|604|0","ZMW|Zambian Kwacha|ZK|ZM|26|0","BWP|Botswana Pula|P|BW|13.6|0",
    "ETB|Ethiopian Birr|Br|ET|120|0","BRL|Brazilian Real|R$|BR|5.0|0","MXN|Mexican Peso|MX$|MX|17.2|0","ARS|Argentine Peso|AR$|AR|900|0",
    "TRY|Turkish Lira|₺|TR|33|0","RUB|Russian Ruble|₽|RU|92|0","PLN|Polish Zloty|zł|PL|4.0|0","SEK|Swedish Krona|kr|SE|10.5|0",
    "NOK|Norwegian Krone|kr|NO|10.7|0","DKK|Danish Krone|kr|DK|6.9|0","SGD|Singapore Dollar|S$|SG|1.34|0","HKD|Hong Kong Dollar|HK$|HK|7.8|0",
    "KRW|South Korean Won|₩|KR|1350|0","THB|Thai Baht|฿|TH|36|0","MYR|Malaysian Ringgit|RM|MY|4.7|0","PHP|Philippine Peso|₱|PH|56|0",
    "IDR|Indonesian Rupiah|Rp|ID|15800|0","PKR|Pakistani Rupee|₨|PK|278|0","BDT|Bangladeshi Taka|৳|BD|117|0","NZD|New Zealand Dollar|NZ$|NZ|1.65|0"
  ];
  var CURRENCIES = RAW.map(function (s) {
    var a = s.split("|");
    return { code: a[0], name: a[1], symbol: a[2], cc: a[3], flag: flag(a[3]), perUSD: Number(a[4]), pop: a[5] === "1" };
  });
  var byCode = {}; CURRENCIES.forEach(function (c) { byCode[c.code] = c; });

  var EU = ["DE","FR","IT","ES","NL","IE","PT","BE","AT","FI","GR"];
  var CRAW = [
    "NG|Nigeria|NGN","GH|Ghana|GHS","KE|Kenya|KES","ZA|South Africa|ZAR","US|United States|USD","GB|United Kingdom|GBP","CA|Canada|CAD",
    "AU|Australia|AUD","JP|Japan|JPY","CN|China|CNY","IN|India|INR","AE|United Arab Emirates|AED","SA|Saudi Arabia|SAR","EG|Egypt|EGP",
    "MA|Morocco|MAD","TZ|Tanzania|TZS","UG|Uganda|UGX","RW|Rwanda|RWF","SN|Senegal|XOF","CM|Cameroon|XAF","ZM|Zambia|ZMW","BW|Botswana|BWP",
    "ET|Ethiopia|ETB","BR|Brazil|BRL","MX|Mexico|MXN","AR|Argentina|ARS","TR|Turkey|TRY","PL|Poland|PLN","SE|Sweden|SEK","NO|Norway|NOK",
    "DK|Denmark|DKK","CH|Switzerland|CHF","SG|Singapore|SGD","HK|Hong Kong|HKD","KR|South Korea|KRW","TH|Thailand|THB","MY|Malaysia|MYR",
    "PH|Philippines|PHP","ID|Indonesia|IDR","PK|Pakistan|PKR","BD|Bangladesh|BDT","NZ|New Zealand|NZD",
    "DE|Germany|EUR","FR|France|EUR","IT|Italy|EUR","ES|Spain|EUR","NL|Netherlands|EUR","IE|Ireland|EUR","PT|Portugal|EUR","BE|Belgium|EUR"
  ];
  var LIVE = { NG: 1, GH: 1, KE: 1, ZA: 1, US: 1, GB: 1 };
  var COUNTRIES = CRAW.map(function (s) {
    var a = s.split("|");
    return { code: a[0], name: a[1], flag: flag(a[0]), currency: a[2], status: LIVE[a[0]] ? "Live" : "Coming soon" };
  });
  var cByCode = {}; COUNTRIES.forEach(function (c) { cByCode[c.code] = c; });

  var ls = function () { try { return root.localStorage; } catch (e) { return null; } };
  function load(k, d) { try { var s = ls(); var v = JSON.parse(s.getItem(k)); return (v === null || v === undefined) ? d : v; } catch (e) { return d; } }
  function store(k, v) { try { ls().setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  /* Live rates: apply cached rates now, refresh from /api/rates in the background. */
  function applyRates(m) {
    if (!m) return false; var n = 0;
    CURRENCIES.forEach(function (c) { var v = Number(m[c.code]); if (v > 0 && isFinite(v)) { c.perUSD = v; n++; } });
    return n > 0;
  }
  var cached = load("trex_rates", null);
  if (cached && cached.perUSD) applyRates(cached.perUSD);
  try {
    var proto = root.location && root.location.protocol;
    var fresh = cached && cached.at && (Date.now() - Date.parse(cached.at) < 15 * 60 * 1000);
    if (root.fetch && (proto === "http:" || proto === "https:") && !fresh) {
      root.fetch("/api/rates").then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.ok && j.perUSD && applyRates(j.perUSD)) {
          store("trex_rates", { at: j.at, perUSD: j.perUSD });
          try { if (!cached && !root.sessionStorage.getItem("trex_rates_reloaded")) { root.sessionStorage.setItem("trex_rates_reloaded", "1"); root.location.reload(); } } catch (e) {}
        }
      }).catch(function () {});
    }
  } catch (e) {}

  var T = {
    CURRENCIES: CURRENCIES, COUNTRIES: COUNTRIES, load: load, store: store,
    getCurrency: function (code) { return byCode[code] || null; },
    getCountry: function (cc) { return cByCode[cc] || null; },
    defaultSet: function (cc) {
      var g = cByCode[cc], out = [];
      [g && g.currency, "USD", "GBP", "EUR"].forEach(function (c) { if (c && out.indexOf(c) < 0) out.push(c); });
      return out;
    },
    searchCurrencies: function (q) {
      q = String(q || "").trim().toLowerCase();
      var list = CURRENCIES.slice().sort(function (a, b) { return (b.pop ? 1 : 0) - (a.pop ? 1 : 0); });
      if (!q) return list;
      return list.filter(function (c) {
        var cn = cByCode[c.code] && (COUNTRIES.filter(function (x) { return x.currency === c.code; }).map(function (x) { return x.name.toLowerCase(); }).join(" "));
        return c.code.toLowerCase().indexOf(q) >= 0 || c.name.toLowerCase().indexOf(q) >= 0 || c.symbol.toLowerCase().indexOf(q) >= 0 || (cn && cn.indexOf(q) >= 0);
      });
    },
    adminCfg: function () { return load("trex_admin_config", { disabled: [], pausedPairs: [], fees: { pct: 1.5 } }); },
    currencyStatus: function (code) {
      if (!byCode[code]) return "DISABLED";
      var cfg = T.adminCfg();
      return (cfg.disabled || []).indexOf(code) >= 0 ? "DISABLED" : "LIVE";
    },
    ratesInfo: function () { var c = load("trex_rates", null); return c ? c.at : null; },
    refRate: function (a, b) {
      var x = byCode[a], y = byCode[b];
      if (!x || !y) return null;
      if (a === b) return 1;
      return y.perUSD / x.perUSD;
    },
    pairStatus: function (a, b) {
      if (a === b || !byCode[a] || !byCode[b]) return "DISABLED";
      if (T.currencyStatus(a) === "DISABLED" || T.currencyStatus(b) === "DISABLED") return "DISABLED";
      var p = (T.adminCfg().pausedPairs || []);
      if (p.indexOf(a + "-" + b) >= 0 || p.indexOf(b + "-" + a) >= 0) return "PAUSED";
      return "LIVE";
    },
    fmt: function (amount, code) {
      var c = byCode[code], n = Number(amount) || 0, abs = Math.abs(n), dec;
      if (code === "JPY" || code === "KRW" || code === "IDR" || code === "UGX" || code === "RWF" || code === "XOF" || code === "XAF" || code === "TZS") dec = abs >= 1 ? 0 : 4;
      else if (abs >= 1 || abs === 0) dec = 2; else dec = 6;
      var whole = Math.abs(n - Math.round(n)) < 0.005 && abs >= 1;
      var s = n.toLocaleString("en-US", { minimumFractionDigits: (dec === 2 && !whole) ? 2 : 0, maximumFractionDigits: whole ? 0 : dec });
      return (c ? c.symbol : (code || "")) + s;
    },
    fmtMoney: function (amount, code) { return T.fmt(amount, code); },
    quote: function (o) {
      var rate = T.refRate(o.send, o.recv);
      var amt = Number(o.amount) || 0, pct = o.feePct == null ? 1.5 : Number(o.feePct);
      if (!rate || !(amt >= 0)) return null;
      var gross = amt * rate, fee = gross * pct / 100;
      return { send: o.send, recv: o.recv, amount: amt, rate: rate, feePct: pct, fee: fee, net: gross - fee, at: new Date().toISOString() };
    },
    audit: function (msg) {
      var a = load("trex_audit", []); a.push(new Date().toISOString() + " " + msg); store("trex_audit", a.slice(-100));
    },
    profile: function () { return load("trex_profile", null); },
    saveProfile: function (p) { store("trex_profile", p); return p; },
    localTime: function (iso) {
      var d = iso ? new Date(iso) : new Date();
      return isNaN(d.getTime()) ? "—" : d.toLocaleString();
    },
    parseVendor: function (s) {
      var parts = String(s || "").split("•").map(function (x) { return x.trim(); });
      var name = parts[0] || "Vendor", rating = null, trades = 0;
      parts.slice(1).forEach(function (p) {
        var r = p.match(/★\s*([0-9.]+)/); if (r) rating = Number(r[1]);
        var t = p.match(/(\d+)\s*trades?/i); if (t) trades = Number(t[1]);
      });
      return { name: name, rating: rating, trades: trades };
    },
    normalizeOffer: function (o) {
      o = Object.assign({}, o || {});
      var pr = String(o.pair || "").split("/");
      o.provide = o.provide || pr[0]; o.want = o.want || pr[1];
      o.rate = Number(o.rate) || 0; o.min = Number(o.min) || 0; o.max = Number(o.max) || 0;
      o.live = o.live !== false;
      o.methods = Array.isArray(o.methods) && o.methods.length ? o.methods : ["Bank transfer"];
      o.capacity = (o.capacity === undefined || o.capacity === null) ? 5000 : Number(o.capacity);
      o.tier = o.tier || "Probation";
      o.vendor = o.vendor || "Vendor";
      if (o.legacy === undefined) o.legacy = false;
      return o;
    },
    paymentsFor: function (cc, cur) {
      var m = [{ id: "bank", name: "Bank transfer", eta: "minutes" }];
      if (cur === "USD" || cur === "GBP" || cur === "EUR") m.push({ id: "wise", name: "Wise / PayPal receipt", eta: "minutes" });
      return { available: true, methods: m };
    }
  };
  root.TREX = T;
})(typeof window !== "undefined" ? window : globalThis);
