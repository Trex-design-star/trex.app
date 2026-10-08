/* Trex trade chat — WhatsApp-style, near-real-time (polling). Chat.mount(el, tradeId, opts) */
(function (root) {
  "use strict";
  var CSS = ".wa{display:flex;flex-direction:column;height:430px;border:1px solid #E4E0D6;border-radius:14px;overflow:hidden;background:#EFE7DD;font-family:Inter,-apple-system,'Segoe UI',Roboto,sans-serif}"
  + ".wa-h{background:#0B0D12;color:#fff;padding:10px 12px;display:flex;align-items:center;gap:10px}.wa-av{width:36px;height:36px;border-radius:50%;background:#155EEF;display:flex;align-items:center;justify-content:center;font-size:18px}"
  + ".wa-h b{display:block;font-size:14px}.wa-h small{color:#9AA0AA;font-size:11px}"
  + ".wa-b{flex:1;overflow-y:auto;padding:10px 10px 4px;display:flex;flex-direction:column;gap:4px}"
  + ".wa-m{max-width:80%;padding:6px 8px 4px;border-radius:0 10px 10px 10px;background:#fff;box-shadow:0 1px 1px rgba(0,0,0,.12);font-size:14px;line-height:1.35;word-wrap:break-word;align-self:flex-start;color:#0B0D12}"
  + ".wa-m.me{background:#D9FDD3;border-radius:10px 0 10px 10px;align-self:flex-end}"
  + ".wa-m img{max-width:220px;max-height:220px;border-radius:8px;display:block;margin-bottom:3px;cursor:pointer}"
  + ".wa-t{font-size:10px;color:#667781;text-align:right;margin-top:1px;white-space:nowrap}.wa-t .rd{color:#53BDEB}"
  + ".wa-s{align-self:center;background:#FFF5C4;color:#54440B;font-size:12px;padding:5px 10px;border-radius:8px;text-align:center;max-width:90%;margin:3px 0}"
  + ".wa-d{align-self:center;background:#E1F2FB;color:#54656F;font-size:11px;padding:3px 10px;border-radius:8px;margin:6px 0}"
  + ".wa-q{display:flex;gap:6px;flex-wrap:wrap;padding:4px 8px;background:#EFE7DD}.wa-q button{border:1px solid #cfd8dc;background:#fff;border-radius:999px;padding:5px 10px;font-size:12px;cursor:pointer}"
  + ".wa-i{display:flex;gap:6px;align-items:center;padding:8px;background:#F0F2F5}.wa-i input[type=text]{flex:1;border:0;border-radius:20px;padding:10px 14px;font-size:15px;outline:none;margin:0;width:auto}"
  + ".wa-clip{cursor:pointer;font-size:20px;padding:0 4px}.wa-send{border:0;background:#25D366;color:#fff;width:40px;height:40px;border-radius:50%;font-size:18px;cursor:pointer}"
  + ".wa-e{color:#D92D20;font-size:12px;padding:2px 10px;background:#FEE4E2}";
  function esc(x) { return String(x == null ? "" : x); }
  function hhmm(iso) { var d = new Date(iso); return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  function dayLabel(iso) { var d = new Date(iso), n = new Date(); if (d.toDateString() === n.toDateString()) return "Today"; var y = new Date(n - 864e5); if (d.toDateString() === y.toDateString()) return "Yesterday"; return d.toLocaleDateString(); }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function shrink(file, cb) {
    var r = new FileReader();
    r.onload = function () { var im = new Image(); im.onload = function () {
      var s = Math.min(1, 900 / Math.max(im.width, im.height)), c = document.createElement("canvas"); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      var q = 0.7, out = c.toDataURL("image/jpeg", q); while (out.length > 380000 && q > 0.3) { q -= 0.15; out = c.toDataURL("image/jpeg", q); } cb(out);
    }; im.onerror = function () { cb(null); }; im.src = r.result; };
    r.readAsDataURL(file);
  }
  var Chat = { mount: function (host, tradeId, opts) {
    opts = opts || {};
    if (!document.getElementById("wa-css")) { var st = el("style"); st.id = "wa-css"; st.textContent = CSS; document.head.appendChild(st); }
    host.innerHTML = "";
    var wa = el("div", "wa"), head = el("div", "wa-h"), av = el("div", "wa-av", "👤"), tw = el("div");
    var title = el("b", null, opts.title || "Trade chat"), sub = el("small", null, tradeId + " • private to you two");
    tw.appendChild(title); tw.appendChild(sub); head.appendChild(av); head.appendChild(tw);
    var body = el("div", "wa-b"), err = el("div", "wa-e"); err.style.display = "none";
    var q = el("div", "wa-q"), inp = el("div", "wa-i"), clip = el("label", "wa-clip", "📎"), file = el("input"), txt = el("input"), send = el("button", "wa-send", "➤");
    file.type = "file"; file.accept = "image/*"; file.style.display = "none"; clip.appendChild(file);
    txt.type = "text"; txt.placeholder = "Type a message"; txt.maxLength = 1000;
    inp.appendChild(clip); inp.appendChild(txt); inp.appendChild(send);
    (opts.quick || []).forEach(function (t) { var b = el("button", null, t); b.onclick = function () { sendText(t); }; q.appendChild(b); });
    wa.appendChild(head); wa.appendChild(body); wa.appendChild(err); if ((opts.quick || []).length) wa.appendChild(q); wa.appendChild(inp); host.appendChild(wa);
    var msgs = [], role = "", otherRead = "", last = "", timer = null, dead = false, pending = [];
    function showErr(m) { err.textContent = m; err.style.display = "block"; setTimeout(function () { err.style.display = "none"; }, 5000); }
    function render() {
      var atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80, day = "";
      body.innerHTML = "";
      msgs.concat(pending).forEach(function (m) {
        var dl = dayLabel(m.at); if (dl !== day) { day = dl; body.appendChild(el("div", "wa-d", dl)); }
        if (m.from === "system") { body.appendChild(el("div", "wa-s", m.text)); return; }
        var mine = m.from === role, b = el("div", "wa-m" + (mine ? " me" : ""));
        if (m.img) { var im = el("img"); im.src = m.img; im.onclick = function () { var w = window.open(); if (w) w.document.write("<img src='" + m.img + "' style='max-width:100%'>"); }; b.appendChild(im); }
        if (m.text) b.appendChild(el("div", null, m.text));
        var t = el("div", "wa-t"); t.appendChild(document.createTextNode(hhmm(m.at) + (mine ? " " : "")));
        if (mine) { var tk = el("span", m.pending ? "" : (otherRead && otherRead >= m.at ? "rd" : ""), m.pending ? "🕓" : (otherRead && otherRead >= m.at ? "✓✓" : "✓")); t.appendChild(tk); }
        b.appendChild(t); body.appendChild(b);
      });
      if (atBottom || !body._init) { body.scrollTop = body.scrollHeight; body._init = 1; }
    }
    function tick() {
      if (dead) return;
      API.get("/chat?trade=" + encodeURIComponent(tradeId) + (last ? "&since=" + encodeURIComponent(last) : "")).then(function (r) {
        if (dead) return;
        if (r && r.ok) {
          role = r.role; otherRead = r.other_read || otherRead; var known = {}; msgs.forEach(function (m) { known[m.id] = 1; });
          var add = (r.messages || []).filter(function (m) { return !known[m.id]; });
          if (add.length) { msgs = msgs.concat(add); last = msgs[msgs.length - 1].at; }
          if (role === "admin") inp.style.display = "none";
          render(); if (opts.onState) opts.onState(r.state);
        } else if (r && r.error && !msgs.length) { body.innerHTML = ""; body.appendChild(el("div", "wa-s", r.error)); }
      }).catch(function () {}).then(function () { timer = setTimeout(tick, document.hidden ? 12000 : 2500); });
    }
    function sendText(t, image) {
      t = (t || "").trim(); if (!t && !image) return;
      var p = { id: "p" + Date.now(), from: role || "me", text: t, img: image || null, at: new Date().toISOString(), pending: true }; pending.push(p); render();
      API.post("/chat", { trade: tradeId, text: t, image: image || undefined }, API.key()).then(function (r) {
        pending = pending.filter(function (x) { return x !== p; });
        if (r && r.ok) { msgs.push(r.message); last = r.message.at; } else showErr((r && r.error) || "Couldn't send. Try again.");
        render();
      }).catch(function () { pending = pending.filter(function (x) { return x !== p; }); showErr("No connection — message not sent."); render(); });
    }
    send.onclick = function () { var v = txt.value; txt.value = ""; sendText(v); };
    txt.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); send.onclick(); } };
    file.onchange = function () { if (file.files[0]) shrink(file.files[0], function (d) { if (d) sendText("", d); else showErr("Couldn't read that image."); }); file.value = ""; };
    tick();
    return { stop: function () { dead = true; clearTimeout(timer); }, refresh: function () { clearTimeout(timer); tick(); } };
  } };
  root.Chat = Chat;
})(typeof window !== "undefined" ? window : globalThis);
