/* Trex API client. Talks to /api (Netlify Function). Falls back to local mode if unreachable. */
(function (root) {
  "use strict";
  var proto = (root.location && root.location.protocol) || "file:";
  var BASE = "/api";
  var API = { on: proto === "http:" || proto === "https:", base: BASE };

  function uid() {
    try { var a = new Uint8Array(12); root.crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
    catch (e) { return String(Date.now()) + Math.random().toString(16).slice(2); }
  }
  API.token = function () { try { return root.localStorage.getItem("trex_session") || ""; } catch (e) { return ""; } };
  API.key = function () { return "k_" + uid(); };

  function parse(r) {
    return r.text().then(function (t) {
      try { return JSON.parse(t); } catch (e) { return { ok: false, error: "Unexpected server reply." }; }
    });
  }
  API.get = function (path) {
    var gh = { Accept: "application/json" }; if (API.token()) gh.Authorization = "Bearer " + API.token();
    return fetch(BASE + path, { headers: gh }).then(parse);
  };
  API.post = function (path, body, key) {
    var h = { "Content-Type": "application/json" };
    if (key) h["X-Idempotency-Key"] = key;
    if (API.token()) h.Authorization = "Bearer " + API.token();
    return fetch(BASE + path, { method: "POST", headers: h, body: JSON.stringify(body || {}) }).then(parse);
  };

  if (API.on && root.fetch) {
    fetch(BASE + "/health").then(parse).then(function (r) { if (!(r && r.ok)) API.on = false; }).catch(function () { API.on = false; });
  } else { API.on = false; }
  root.API = API;
})(typeof window !== "undefined" ? window : globalThis);
