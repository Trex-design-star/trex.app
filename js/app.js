/* Trex app shell: sign-in guard, role guard, notification bell + pop-ups, role-aware navigation. */
(function (root) {
  "use strict";
  var path = location.pathname.split("/").pop() || "index.html";
  var tok = localStorage.getItem("trex_session") || "";
  var cbs = [], ME = null, seen = null;
  var App = { me: function () { return ME; }, ready: function (f) { if (ME) f(ME); else cbs.push(f); } };
  root.TREXAPP = App;
  if (!tok) { location.replace("signin.html?next=" + encodeURIComponent(path + location.search)); return; }
  function H() { return { Authorization: "Bearer " + tok }; }
  function esc(x) { return String(x == null ? "" : x).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  App.esc = esc;
  fetch("/api/me", { headers: H() }).then(function (r) { if (r.status === 401) { localStorage.removeItem("trex_session"); location.replace("signin.html?next=" + encodeURIComponent(path + location.search)); return null; } return r.json(); }).then(function (j) {
    if (!j || !j.ok) return; ME = j.me;
    var role = document.body && document.body.getAttribute("data-role");
    if (role === "admin" && !ME.admin) { location.replace("dashboard.html"); return; }
    if (role === "vendor" && !ME.vendor) { location.replace("vendor.html"); return; }
    shell(); cbs.splice(0).forEach(function (f) { f(ME); }); poll();
  }).catch(function () {});
  function shell() {
    var nav = document.querySelector(".nav");
    if (nav && !document.getElementById("bell")) {
      var a = document.createElement("a"); a.id = "bell"; a.className = "bell"; a.href = "notifications.html"; a.innerHTML = "🔔<i style='display:none'></i>"; a.setAttribute("aria-label", "Notifications");
      var right = nav.querySelector("span") || nav; right.appendChild(a);
    }
    document.querySelectorAll('.bottomnav a[href="vendor.html"]').forEach(function (l) { if (ME.vendor) { l.href = "vendor-dashboard.html"; l.textContent = "Vendor"; } });
    badge(ME.unread || 0);
  }
  function badge(n) { var b = document.querySelector("#bell i"); if (b) { b.style.display = n ? "" : "none"; b.textContent = n > 99 ? "99+" : n; } document.title = (n ? "(" + n + ") " : "") + document.title.replace(/^\(\d+\) /, ""); }
  function toast(it) {
    var d = document.createElement("div"); d.className = "ntoast"; d.innerHTML = "<b>" + esc(it.title) + "</b><span>" + esc(it.body) + "</span>";
    d.onclick = function () { d.remove(); if (it.link) location.href = it.link; }; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 6000);
  }
  function poll() {
    fetch("/api/notifications", { headers: H() }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) return; badge(j.unread);
      var ids = j.items.map(function (x) { return x.id; });
      if (seen) j.items.filter(function (x) { return !x.read && seen.indexOf(x.id) < 0 && !(path === "notifications.html"); }).slice(0, 2).forEach(toast);
      seen = ids;
    }).catch(function () {}).then(function () { setTimeout(poll, document.hidden ? 45000 : 12000); });
  }
})(typeof window !== "undefined" ? window : globalThis);
