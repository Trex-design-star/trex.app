/* Trex API client: attaches your login, signs you out if it expires. */
(function (root) {
  "use strict";
  var BASE = "/api", API = { on: true, base: BASE };
  API.token = function () { try { return root.localStorage.getItem("trex_session") || ""; } catch (e) { return ""; } };
  API.key = function () { try { var a = new Uint8Array(12); root.crypto.getRandomValues(a); return "k_" + Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); } catch (e) { return "k_" + Date.now() + Math.random().toString(16).slice(2); } };
  function expired() { try { localStorage.removeItem("trex_session"); sessionStorage.removeItem("trex_me"); } catch (e) {} var p = location.pathname.split("/").pop(); if (["signin.html", "onboarding.html", "index.html", ""].indexOf(p) < 0) location.replace("signin.html?next=" + encodeURIComponent(p + location.search)); }
  function parse(r) { return r.text().then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { j = { ok: false, error: "Unexpected server reply." }; } if (r.status === 401 && API.token() && !/login|signup|verify|reset/.test(r.url)) expired(); return j; }); }
  API.get = function (path) { var h = { Accept: "application/json" }; if (API.token()) h.Authorization = "Bearer " + API.token(); return fetch(BASE + path, { headers: h }).then(parse); };
  API.post = function (path, body, key) { var h = { "Content-Type": "application/json" }; if (key) h["X-Idempotency-Key"] = key; if (API.token()) h.Authorization = "Bearer " + API.token(); return fetch(BASE + path, { method: "POST", headers: h, body: JSON.stringify(body || {}) }).then(parse); };
  API.signOut = function (all) { return API.post("/signout", { all: !!all }).catch(function () {}).then(function () { try { localStorage.removeItem("trex_session"); sessionStorage.removeItem("trex_me"); } catch (e) {} location.href = "signin.html"; }); };
  root.API = API;
})(typeof window !== "undefined" ? window : globalThis);
