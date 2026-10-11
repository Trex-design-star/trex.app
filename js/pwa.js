/* Trex PWA: registers the service worker and makes "Install Trex" impossible to miss. */
(function (root) {
  "use strict";
  var standalone = (root.matchMedia && root.matchMedia("(display-mode: standalone)").matches) || root.navigator.standalone === true || /TrexApp\//.test(root.navigator.userAgent || "");
  var ua = root.navigator.userAgent || "", iOS = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && root.navigator.maxTouchPoints > 1);
  var deferred = null, installed = standalone;
  var PWA = { installed: function () { return installed; }, canInstall: function () { return !installed && (!!deferred || iOS); }, install: install };
  root.TREXPWA = PWA;

  if ("serviceWorker" in navigator && /^https?:/.test(location.protocol)) {
    var had = !!navigator.serviceWorker.controller;
    root.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function () {}); });
    navigator.serviceWorker.addEventListener("controllerchange", function () { if (had) bar("Trex was updated.", "Refresh", function () { location.reload(); }, "upd"); had = true; });
  }
  function el(t, css, html) { var e = document.createElement(t); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }
  function bar(text, btn, fn, id) {
    if (document.getElementById("pwa-" + id)) return;
    var b = el("div", "position:fixed;left:10px;right:10px;bottom:76px;z-index:80;background:#0B0D12;color:#fff;border:2px solid #155EEF;border-radius:16px;padding:12px 14px;display:flex;gap:10px;align-items:center;box-shadow:0 12px 40px rgba(0,0,0,.45);font-family:Inter,-apple-system,sans-serif;max-width:560px;margin:0 auto");
    b.id = "pwa-" + id;
    b.innerHTML = "<img src='/icons/icon-192.png' alt='' style='width:44px;height:44px;border-radius:10px'><div style='flex:1;font-size:14px;line-height:1.3'>" + text + "</div>";
    var go = el("button", "border:0;background:#155EEF;color:#fff;font-weight:800;border-radius:10px;padding:10px 14px;font-size:14px;cursor:pointer", btn); go.onclick = fn;
    var x = el("button", "border:0;background:none;color:#9AA0AA;font-size:20px;cursor:pointer", "×"); x.setAttribute("aria-label", "Dismiss");
    x.onclick = function () { b.remove(); if (id === "ins") try { localStorage.setItem("trex_pwa_dismiss", String(Date.now())); } catch (e) {} };
    b.appendChild(go); b.appendChild(x); document.body.appendChild(b); return b;
  }
  function iosHelp() {
    var m = el("div", "position:fixed;inset:0;background:rgba(11,13,18,.7);z-index:90;display:flex;align-items:flex-end;justify-content:center");
    m.innerHTML = "<div style='background:#fff;color:#0B0D12;border-radius:18px 18px 0 0;padding:20px;max-width:560px;width:100%;font-family:Inter,-apple-system,sans-serif'><div style='display:flex;gap:12px;align-items:center'><img src='/icons/icon-192.png' alt='' style='width:56px;height:56px;border-radius:12px'><div><b style='font-size:18px'>Install Trex on your iPhone</b><div style='color:#4B5563;font-size:13px'>Three taps — no App Store needed</div></div></div>"
      + "<ol style='line-height:1.9;font-size:15px;padding-left:20px'><li>Open this page in <b>Safari</b></li><li>Tap the <b>Share</b> button <span style='font-size:18px'>⬆︎</span> at the bottom</li><li>Scroll and tap <b>Add to Home Screen</b>, then <b>Add</b></li></ol>"
      + "<button style='width:100%;border:0;border-radius:12px;padding:13px;font-size:15px;font-weight:700;background:#0B0D12;color:#fff;cursor:pointer'>Got it</button></div>";
    m.querySelector("button").onclick = function () { m.remove(); }; m.onclick = function (e) { if (e.target === m) m.remove(); }; document.body.appendChild(m);
  }
  function install() {
    if (installed) return;
    if (deferred) { var d = deferred; deferred = null; d.prompt(); d.userChoice.then(function (c) { if (c.outcome === "accepted") done(); refresh(); }); }
    else if (iOS) iosHelp();
    else bar("To install: open your browser menu and choose <b>Install app</b> or <b>Add to Home screen</b>.", "OK", function () { var b = document.getElementById("pwa-help"); if (b) b.remove(); }, "help");
  }
  function done() { installed = true; refresh(); var b = document.getElementById("pwa-ins"); if (b) b.remove(); }
  function refresh() { document.querySelectorAll("[data-install]").forEach(function (b) { b.style.display = installed ? "none" : ""; }); }
  root.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferred = e; refresh(); offer(); });
  root.addEventListener("appinstalled", done);
  function offer() {
    if (installed || document.getElementById("pwa-ins")) return;
    var last = 0; try { last = Number(localStorage.getItem("trex_pwa_dismiss") || 0); } catch (e) {}
    if (Date.now() - last < 7 * 864e5) return;
    bar("<b>Install the Trex app</b><br><span style='color:#9AA0AA;font-size:12px'>Faster, full-screen, with instant alerts</span>", "Install", install, "ins");
  }
  document.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-install]"); if (b) { e.preventDefault(); install(); } });
  function ready() {
    refresh();
    if (!installed && iOS && !document.getElementById("pwa-ins")) { var last = 0; try { last = Number(localStorage.getItem("trex_pwa_dismiss") || 0); } catch (e) {} if (Date.now() - last > 7 * 864e5) setTimeout(function () { bar("<b>Install Trex on your iPhone</b><br><span style='color:#9AA0AA;font-size:12px'>Tap Install to see how</span>", "Install", install, "ins"); }, 2500); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready); else ready();
})(typeof window !== "undefined" ? window : globalThis);
