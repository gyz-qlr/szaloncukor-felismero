// Live camera mode: the candy is held in the on-screen outline; the white paper is sampled right above and
// below it, the foil inside the body. Every valid frame adds its white-balanced foil colours; when enough
// frames agree, the outline blinks green and the result is shown. Back camera only.
(function () {
  "use strict";
  const T = window.SZC_TEMPLATE, M = window.Match, A = window.SZC;
  const $ = (id) => document.getElementById(id);
  const CW = 270, CH = Math.round(CW * T.h / T.w); // processing canvas = the visible camera box
  const FRAMES_MIN = 12, FRAMES_MAX = 36, CHECK_EVERY = 4, POINTS_PER_FRAME = 900, INTERVAL_MS = 110;
  const SCALE_KEY = "szc_tplscale_v1";
  const lum = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];

  const box = $("liveBox"), video = $("liveVideo"), tpl = $("liveTpl");
  const canvas = document.createElement("canvas");
  canvas.width = CW; canvas.height = CH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  let stream = null, timer = null, zones = null;
  let scale = A.store.get(SCALE_KEY, 0.6);
  let acc = null; // {points, frames, sum, checkpoint}

  // ---------- template geometry (template box centred in the camera box, `scale` of its height) ----------
  const toBox = (u, v) => [(1 - scale) / 2 + scale * u, (1 - scale) / 2 + scale * v];

  function placeTemplate() {
    const [l, t] = toBox(0, 0);
    Object.assign(tpl.style, { left: `${l * 100}%`, top: `${t * 100}%`, width: `${scale * 100}%`, height: `${scale * 100}%` });
    const place = (el, [y0, y1, x0, x1]) => Object.assign(el.style, {
      top: `${y0 * 100}%`, height: `${(y1 - y0) * 100}%`, left: `${x0 * 100}%`, width: `${(x1 - x0) * 100}%` });
    place($("pzTop"), T.paperTop);
    place($("pzBottom"), T.paperBottom);
    zones = buildZones();
  }

  function rectIdx(y0, y1, x0, x1) {
    const [bx0, by0] = toBox(x0, y0), [bx1, by1] = toBox(x1, y1), out = [];
    for (let y = Math.round(by0 * CH); y <= Math.round(by1 * CH); y++)
      for (let x = Math.round(bx0 * CW); x <= Math.round(bx1 * CW); x++) out.push((y * CW + x) * 4);
    return out;
  }

  function buildZones() {
    const foil = [];
    for (let i = 0; i + 1 < T.foil.length; i++) {
      const [v0, a0, b0] = T.foil[i], [v1] = T.foil[i + 1];
      const [, by0] = toBox(0, v0), [, by1] = toBox(0, v1);
      for (let y = Math.round(by0 * CH); y < Math.round(by1 * CH); y++) {
        const [bx0] = toBox(a0, 0), [bx1] = toBox(b0, 0);
        for (let x = Math.round(bx0 * CW); x <= Math.round(bx1 * CW); x++) foil.push((y * CW + x) * 4);
      }
    }
    const step = Math.max(1, Math.ceil(foil.length / POINTS_PER_FRAME));
    return { foil: foil.filter((_, i) => i % step === 0), top: rectIdx(...T.paperTop), bottom: rectIdx(...T.paperBottom) };
  }

  // ---------- UI state ----------
  function setState(state, hint, progress) {
    box.className = "livebox " + state;
    if (hint !== undefined) $("liveHint").textContent = hint;
    $("liveBar").style.width = `${Math.round(Math.min(1, progress || 0) * 100)}%`;
  }

  // ---------- camera ----------
  async function start() {
    A.showSection("live");
    placeTemplate();
    setState("align", "Kamera indítása…", 0);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return fail("Ez a böngésző nem ad hozzáférést a kamerához. Nyisd meg az oldalt Safariban vagy Chrome-ban (https-en), vagy használd a kézi módot.");
    }
    const facing = new URLSearchParams(location.search).has("anycam") ? "environment" : { exact: "environment" };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    } catch (e) {
      const msg = e && (e.name === "NotAllowedError" || e.name === "SecurityError")
        ? "A kamera használata nincs engedélyezve. Engedélyezd a böngésző beállításaiban, vagy használd a kézi módot."
        : e && (e.name === "OverconstrainedError" || e.name === "NotFoundError")
          ? "Ezen az eszközön nem találok hátsó kamerát. Telefonon nyisd meg, vagy használd a kézi módot."
          : "A kamera nem indult el. Ha a főképernyőről indítottad, próbáld Safariban/Chrome-ban megnyitva – vagy használd a kézi módot.";
      return fail(msg);
    }
    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* autoplay is allowed for muted inline video; ignore */ }
    acc = null;
    setState("align", "Tartsd a szaloncukrot a körvonalba – a fehér papírvégek a kék sávokba essenek.", 0);
    timer = setInterval(tick, INTERVAL_MS);
  }

  function stop() {
    clearInterval(timer); timer = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; video.srcObject = null;
  }

  function fail(msg) { stop(); setState("align error", msg, 0); }

  // ---------- per-frame analysis ----------
  function tick() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return;
    // the part of the video the box shows (object-fit: cover)
    const aspect = T.w / T.h;
    let sw = vw, sh = vw / aspect;
    if (sh > vh) { sh = vh; sw = vh * aspect; }
    ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, CW, CH);
    const d = ctx.getImageData(0, 0, CW, CH).data;
    const lin = (i) => [M.LINEAR_8BIT[d[i]], M.LINEAR_8BIT[d[i + 1]], M.LINEAR_8BIT[d[i + 2]]];

    const pTop = M.robustMean(zones.top.map(lin), "paper"), pBot = M.robustMean(zones.bottom.map(lin), "paper");
    const foilPx = zones.foil.map(lin);
    const foilLum = foilPx.map(lum).sort((a, b) => a - b)[Math.floor(foilPx.length / 2)];
    const chroma = (p) => { const s = p[0] + p[1] + p[2] || 1; return [p[0] / s, p[1] / s]; };
    const [rt, gt] = chroma(pTop), [rb, gb] = chroma(pBot);
    const lt = lum(pTop), lb = lum(pBot);

    if (lt < 0.05 || lb < 0.05 || Math.min(lt, lb) < 1.25 * foilLum) {
      return notReady("A kék sávokban nem látszik a fehér papírvég. Igazítsd a szaloncukrot a körvonalba – ha nem fér bele, állíts a sablon méretén (− / +).");
    }
    if (Math.max(lt, lb) / Math.min(lt, lb) > 1.8 || Math.abs(rt - rb) > 0.035 || Math.abs(gt - gb) > 0.035) {
      return notReady("A két kék sávban nem ugyanaz látszik – lóg bele a sztaniol, vagy árnyék esik rá? Igazíts rajta, vagy állíts a sablon méretén (− / +).");
    }
    const paper = [0, 1, 2].map((c) => (pTop[c] + pBot[c]) / 2);
    const pts = foilPx.filter((p) => !M.isClipped(p)).map((p) => M.correct(paper, p));
    if (pts.filter(M.isPaperLike).length > 0.4 * pts.length) {
      return notReady("A körvonalban papírt látok – a sztaniol legyen a körvonalon belül.");
    }
    const mean = [0, 1, 2].map((c) => pts.reduce((s, p) => s + p[c], 0) / pts.length);
    if (acc && acc.last && M.deltaE(mean, acc.last, 1) > 9) {
      acc.last = mean;
      return notReady("Tartsd nyugodtan…", true);
    }
    if (acc && acc.frames && M.deltaE(mean, acc.sum.map((v) => v / acc.frames), 1) > 18) acc = null; // another candy
    if (!acc) acc = { points: [], frames: 0, sum: [0, 0, 0], checkpoint: null };
    acc.last = mean;
    acc.points.push(...pts);
    acc.frames++;
    acc.miss = 0;
    acc.sum = acc.sum.map((v, c) => v + mean[c]);

    if (acc.frames >= FRAMES_MIN && acc.frames % CHECK_EVERY === 0) {
      const prof = M.profileFromLab(acc.points);
      const main = prof && [prof[0].L, prof[0].a, prof[0].b];
      const steady = main && acc.checkpoint && M.deltaE(main, acc.checkpoint) < 3;
      if (prof && (steady || acc.frames >= FRAMES_MAX)) return finish(prof);
      acc.checkpoint = main;
    }
    setState("collect", `Színek gyűjtése… ${acc.frames} kép`, acc.frames / FRAMES_MIN);
  }

  function notReady(hint, keep) {
    if (!keep && acc && acc.frames) acc.miss = (acc.miss || 0) + 1;
    if (acc && acc.miss > 8) acc = null; // lost the candy for about a second: start again
    setState(acc && acc.frames ? "collect" : "align", hint, acc ? acc.frames / FRAMES_MIN : 0);
  }

  function finish(profile) {
    clearInterval(timer); timer = null;
    setState("done", "Megvan! Eredmény…", 1);
    setTimeout(() => { stop(); A.showResults({ profile }, { source: "live", frames: acc.frames }); }, 1300);
  }

  // ---------- events ----------
  $("liveBtn").addEventListener("click", start);
  $("liveCancel").addEventListener("click", () => { stop(); A.showSection("start"); });
  const resize = (k) => { scale = Math.max(0.35, Math.min(0.9, Math.round((scale + k) * 100) / 100)); A.store.set(SCALE_KEY, scale); placeTemplate(); acc = null; };
  $("tplSmaller").addEventListener("click", () => resize(-0.04));
  $("tplBigger").addEventListener("click", () => resize(0.04));
  document.addEventListener("visibilitychange", () => { if (document.hidden && stream) { stop(); A.showSection("start"); } });
  A.onRestart = (live) => { if (live) start(); };
  if (new URLSearchParams(location.search).has("autolive")) start(); // for automated tests
})();
