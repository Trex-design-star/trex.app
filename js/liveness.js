/* Trex face check (liveness): random challenges, live-motion detection, duplicate-face fingerprint. */
(function (root) {
  "use strict";
  var ALL = [["Turn your head slowly to the LEFT", "left"], ["Turn your head slowly to the RIGHT", "right"], ["Tilt your head UP a little", "up"], ["Smile 😀", "smile"], ["Blink twice", "blink"]];
  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function gray(video, n) { var c = document.createElement("canvas"); c.width = c.height = n; var x = c.getContext("2d"); x.drawImage(video, 0, 0, n, n); var d = x.getImageData(0, 0, n, n).data, g = new Array(n * n); for (var i = 0; i < n * n; i++) g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11; return g; }
  function diff(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; }
  function ahash(g) { var avg = g.reduce(function (s, v) { return s + v; }, 0) / g.length, bits = ""; g.forEach(function (v) { bits += v > avg ? "1" : "0"; }); var hex = ""; for (var i = 0; i < 64; i += 4) hex += parseInt(bits.substr(i, 4), 2).toString(16); return hex; }
  function frame(video) { var w = 240, h = Math.round(240 * (video.videoHeight || 240) / (video.videoWidth || 240)), c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(video, 0, 0, w, h); return c.toDataURL("image/jpeg", 0.6); }
  function centerHash(video) { var n = 8, c = document.createElement("canvas"); c.width = c.height = n; var vw = video.videoWidth || 240, vh = video.videoHeight || 240, s = Math.min(vw, vh) * 0.6; c.getContext("2d").drawImage(video, (vw - s) / 2, (vh - s) / 2, s, s, 0, 0, n, n); var d = c.getContext("2d").getImageData(0, 0, n, n).data, g = []; for (var i = 0; i < n * n; i++) g.push(d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11); return ahash(g); }
  function fileToJpeg(file, cb) { var r = new FileReader(); r.onload = function () { var im = new Image(); im.onload = function () { var c = document.createElement("canvas"), s = 240 / Math.max(im.width, im.height); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); var url = c.toDataURL("image/jpeg", 0.6), g = document.createElement("canvas"); g.width = g.height = 8; g.getContext("2d").drawImage(im, 0, 0, 8, 8); var d = g.getContext("2d").getImageData(0, 0, 8, 8).data, arr = []; for (var i = 0; i < 64; i++) arr.push(d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11); cb(url, ahash(arr)); }; im.onerror = function () { cb(null); }; im.src = r.result; }; r.readAsDataURL(file); }
  root.Liveness = { start: function (host, onDone) {
    host.innerHTML = "";
    var box = el("div"), vid = el("video"), msg = el("div", "muted", "We'll ask you to make three simple moves so we know a real person is here. Good light helps."), btn = el("button", "btn btn-black", "Start face check"), dots = el("div", "muted", ""), fb = el("div");
    btn.id = "liveStart"; msg.id = "liveMsg"; vid.setAttribute("playsinline", ""); vid.muted = true; vid.autoplay = true;
    vid.style.cssText = "width:220px;height:220px;border-radius:50%;object-fit:cover;background:#0B0D12;display:none;margin:10px auto;border:4px solid #155EEF";
    box.appendChild(vid); box.appendChild(msg); box.appendChild(dots); box.appendChild(btn); box.appendChild(fb); host.appendChild(box);
    var busy = false;
    function fail(t) { msg.textContent = t; msg.style.color = "#D92D20"; btn.disabled = false; btn.textContent = "Try again"; busy = false; }
    function submit(frames, hash, motion, chs, fallback) {
      msg.style.color = ""; msg.textContent = "Checking…";
      API.post("/liveness", { frames: frames, hash: hash, motion: motion, challenges: chs, fallback: !!fallback }, API.key()).then(function (r) {
        if (r && r.ok) { msg.style.color = "#027A48"; msg.textContent = "✓ Face check complete" + (r.status === "review" ? " — our team will review it shortly." : "."); btn.style.display = "none"; fb.style.display = "none"; vid.style.display = "none"; root._liveDone = true; if (onDone) onDone(r); }
        else fail((r && r.error) || "Face check failed. Try again.");
      }).catch(function () { fail("No connection. Check your internet and try again."); });
    }
    function fallback() {
      fb.innerHTML = ""; var l = el("label", null, "Camera not available? Take a clear selfie instead:"), f = el("input"); f.type = "file"; f.accept = "image/*"; f.setAttribute("capture", "user"); f.id = "liveFile";
      f.onchange = function () { if (!f.files[0]) return; fileToJpeg(f.files[0], function (u, h) { if (!u) return fail("Couldn't read that photo."); submit([u, u, u], h, 0, ["selfie"], true); }); };
      fb.appendChild(l); fb.appendChild(f);
    }
    btn.onclick = function () {
      if (busy) return; busy = true; btn.disabled = true; btn.textContent = "Starting camera…";
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { fail("This browser can't open the camera."); fallback(); return; }
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 480 }, audio: false }).then(function (stream) {
        vid.srcObject = stream; vid.style.display = "block"; vid.play();
        var picks = ALL.slice().sort(function () { return Math.random() - 0.5; }).slice(0, 3), frames = [], moves = [], i = 0, hash = "";
        function stop() { stream.getTracks().forEach(function (t) { t.stop(); }); }
        function next() {
          if (i >= picks.length) { stop(); var motion = moves.reduce(function (s, v) { return s + v; }, 0) / moves.length; vid.style.display = "none"; return submit(frames, hash, Math.round(motion * 10) / 10, picks.map(function (p) { return p[1]; })); }
          var base = gray(vid, 32), best = 0, left = 3; dots.textContent = "Step " + (i + 1) + " of 3"; msg.style.color = ""; msg.textContent = picks[i][0] + " — " + left + "s";
          var iv = setInterval(function () { best = Math.max(best, diff(base, gray(vid, 32))); }, 250);
          var cd = setInterval(function () { left--; msg.textContent = picks[i][0] + " — " + Math.max(left, 0) + "s"; }, 1000);
          setTimeout(function () { clearInterval(iv); clearInterval(cd); if (i === 0) hash = centerHash(vid); frames.push(frame(vid)); moves.push(best); i++; next(); }, 3200);
        }
        btn.style.display = "none"; setTimeout(next, 800);
      }).catch(function () { fail("We couldn't open your camera. Allow camera access, or use a selfie instead."); fallback(); });
    };
  } };
})(typeof window !== "undefined" ? window : globalThis);
