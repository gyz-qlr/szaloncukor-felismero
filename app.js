// Szaloncukor-felismerő: photo -> tap the paper -> frame (or tap) the foil -> white-balanced colours -> ranked flavours.
(function () {
  "use strict";
  const F = window.SZALONCUKROK;
  const M = window.Match;
  const $ = (id) => document.getElementById(id);
  const OWN_KEY = "szc_own_v2", OWN_KEY_V1 = "szc_own_v1", ALLOWED_KEY = "szc_allowed_v1", CAL_KEY = "szc_usecal_v1";
  const MAX_SIDE = 1600, MAX_AREA_PIXELS = 15000, DRAG_MIN_CSS = 12;

  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode: keep in memory only */ } },
  };
  // confirmed measurements: {flavourId: [{cols: [{L, a, b, w}]}]} (white-balanced, not calibrated)
  let own = store.get(OWN_KEY, null);
  if (!own) {
    own = {};
    Object.entries(store.get(OWN_KEY_V1, {})).forEach(([id, sets]) => {
      own[id] = sets.map((set) => ({ cols: set.map((l) => ({ L: l[0], a: l[1], b: l[2], w: 1 / set.length })) }));
    });
  }
  let allowed = store.get(ALLOWED_KEY, null); // null = all flavours
  let useCal = store.get(CAL_KEY, true);
  let cal = null;

  // ---------- state ----------
  const canvas = $("photo"), ctx = canvas.getContext("2d");
  let source = null, pixels = null, radius = 8;
  let taps = []; // {x, y, kind: "paper"|"foil", linear}; taps[0] is the paper
  let area = null, profile = null; // framed rectangle and the wrapper colours found in it
  let noBand = false, drag = null;

  const STEPS = [
    ["Koppints a fehér papírvégre", "Ebből igazítja a színeket a fényviszonyokhoz."],
    ["Húzz keretet a sztaniolra", "Ujjal húzd át a szaloncukor közepét – a papírt és a csillogást kihagyja, a sávokat magától megtalálja. (Koppintás is jó a fő színre.)"],
    ["Van más színű sáv vagy címke? Koppints rá", "Ha nincs, nyomd meg: „Nincs más színe”."],
  ];

  function show(id, on) { $(id).hidden = !on; }
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2400); }
  function cssColor(lab) {
    const rgb = M.labToLinear(lab).map((v) => Math.round(255 * M.toSrgb(Math.max(0, Math.min(1, v)))));
    return `rgb(${rgb.join(",")})`;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const done = () => !!profile || taps.length === 3 || (taps.length === 2 && noBand);

  // ---------- calibration ----------
  const ownCount = () => Object.values(own).reduce((s, v) => s + v.length, 0);
  function refreshCalibration() {
    cal = useCal && ownCount() >= 3 ? M.fitCalibration(M.calibrationPairs(F, own)) : null;
  }
  function calibrate(m) {
    if (!cal) return m;
    if (m.profile) return { profile: m.profile.map((c) => { const [L, a, b] = M.applyCalibration(cal, [c.L, c.a, c.b]); return { L, a, b, w: c.w }; }) };
    return { samples: m.samples.map((s) => M.applyCalibration(cal, s)), noSecond: m.noSecond };
  }

  // ---------- photo loading ----------
  function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { setPhoto(img, img.naturalWidth, img.naturalHeight); URL.revokeObjectURL(url); };
    img.onerror = () => toast("Ezt a képet nem sikerült megnyitni.");
    img.src = url;
  }

  function setPhoto(img, w0, h0) {
    const k = Math.min(1, MAX_SIDE / Math.max(w0, h0));
    const w = Math.round(w0 * k), h = Math.round(h0 * k);
    source = document.createElement("canvas");
    source.width = w; source.height = h;
    const sctx = source.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(img, 0, 0, w, h);
    pixels = sctx.getImageData(0, 0, w, h);
    canvas.width = w; canvas.height = h;
    radius = Math.max(5, Math.round(Math.min(w, h) * 0.015));
    taps = []; area = null; profile = null; noBand = false;
    show("start", false); show("measure", true); show("results", false);
    render();
    $("measure").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- sampling ----------
  const linearAt = (i) => [M.LINEAR_8BIT[pixels.data[i]], M.LINEAR_8BIT[pixels.data[i + 1]], M.LINEAR_8BIT[pixels.data[i + 2]]];

  function sampleAt(x, y, kind) {
    const { width: w, height: h } = pixels, r = kind === "paper" ? radius * 2 : radius, out = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = x + dx, py = y + dy;
        if (dx * dx + dy * dy > r * r || px < 0 || py < 0 || px >= w || py >= h) continue;
        out.push(linearAt((py * w + px) * 4));
      }
    }
    return M.robustMean(out, kind);
  }

  function warn(msg, soft) { const w = $("warn"); w.textContent = msg; w.hidden = false; if (!soft) render(); }

  function tap(x, y) {
    if (!pixels || done()) return;
    const kind = taps.length === 0 ? "paper" : "foil";
    const linear = sampleAt(x, y, kind);
    $("warn").hidden = true;
    if (kind === "paper") {
      const lum = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
      if (lum < 0.04) return warn("Ez túl sötét a papírhoz. Koppints a szaloncukor fehér papírvégére.");
      if (Math.max(...linear) > 0.985) warn("A papír beégett (túl világos) – a mérés így is működik, de pontosabb, ha kevésbé erős fényben fotózol.", true);
    } else {
      const lab = M.correct(taps[0].linear, linear);
      if (lab[0] > 90 && Math.hypot(lab[1], lab[2]) < 8) return warn("Ez a papírnak tűnik. Koppints a színes sztaniolra – vagy húzz keretet rá.");
    }
    taps.push({ x, y, kind, linear });
    render();
    if (done()) showResults();
  }

  function frame(r) {
    const x0 = Math.max(0, Math.min(r.x0, r.x1)), x1 = Math.min(pixels.width - 1, Math.max(r.x0, r.x1));
    const y0 = Math.max(0, Math.min(r.y0, r.y1)), y1 = Math.min(pixels.height - 1, Math.max(r.y0, r.y1));
    const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0 + 1) * (y1 - y0 + 1)) / MAX_AREA_PIXELS)));
    const px = [];
    for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) px.push(linearAt((y * pixels.width + x) * 4));
    const prof = M.extractProfile(px, taps[0].linear);
    $("warn").hidden = true;
    if (!prof) { area = null; return warn("A keretben alig van színes sztaniol. Húzd a szaloncukor közepére, kicsit nagyobbra."); }
    area = { x0, y0, x1, y1 }; profile = prof;
    render();
    showResults();
  }

  // ---------- drawing ----------
  function strokeRect(r, dashed) {
    const lw = Math.max(2, Math.round(canvas.width / 300));
    ctx.save();
    ctx.setLineDash(dashed ? [lw * 4, lw * 3] : []);
    ctx.lineWidth = lw * 3; ctx.strokeStyle = "rgba(0,0,0,.6)";
    ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.lineWidth = lw; ctx.strokeStyle = "#ffd36b";
    ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.restore();
  }

  function render() {
    if (!source) return;
    ctx.drawImage(source, 0, 0);
    const lw = Math.max(2, Math.round(canvas.width / 300));
    taps.forEach((t, i) => {
      const r = (i === 0 ? radius * 2 : radius) + lw * 2;
      ctx.lineWidth = lw * 2; ctx.strokeStyle = "rgba(0,0,0,.7)";
      ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, 2 * Math.PI); ctx.stroke();
      ctx.lineWidth = lw; ctx.strokeStyle = i === 0 ? "#fff" : "#ffd36b";
      ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, 2 * Math.PI); ctx.stroke();
      ctx.font = `700 ${radius * 2 + 6}px "Noto Sans", sans-serif`;
      ctx.lineWidth = lw * 2; ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.fillStyle = "#fff";
      const label = i === 0 ? "P" : String(i);
      ctx.strokeText(label, t.x + r + lw * 2, t.y - r * 0.6); ctx.fillText(label, t.x + r + lw * 2, t.y - r * 0.6);
    });
    if (area) strokeRect(area, false);
    if (drag && drag.moved) strokeRect(drag, true);

    const step = taps.length === 0 ? 0 : taps.length === 1 ? 1 : 2;
    $("stepNum").textContent = done() ? "✓" : String(step + 1);
    $("stepText").innerHTML = done() ? "Kész – az eredmény lent látható.<span class=\"hint\">Új méréshez: Vissza vagy Új fotó.</span>"
      : `${STEPS[step][0]}<span class="hint">${STEPS[step][1]}</span>`;
    show("noBandBtn", taps.length === 2 && !noBand && !profile);
    // while framing, a drag on the photo must draw the frame instead of scrolling the page
    canvas.style.touchAction = taps.length >= 1 && !done() ? "none" : "manipulation";

    const sw = [];
    if (profile) {
      calibrate({ profile }).profile.forEach((c) => sw.push(`<span class="chip"><i style="background:${cssColor([c.L, c.a, c.b])}"></i>${Math.round(c.w * 100)}%</span>`));
    } else if (taps.length > 1) {
      calibrate({ samples: taps.slice(1).map((t) => M.correct(taps[0].linear, t.linear)) }).samples
        .forEach((lab, i) => sw.push(`<span class="chip"><i style="background:${cssColor(lab)}"></i>${i === 0 ? "fő szín" : "sáv/címke"}</span>`));
    } else if (taps.length === 1) {
      sw.push(`<span class="chip"><i style="background:#fff"></i>papír rögzítve</span>`);
    }
    $("swatches").innerHTML = sw.join("");
  }

  // ---------- pointer: tap or drag ----------
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: Math.round((e.clientX - r.left) * canvas.width / r.width), y: Math.round((e.clientY - r.top) * canvas.height / r.height), scale: r.width / canvas.width };
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (!pixels || done() || !e.isPrimary) return;
    const p = toCanvas(e);
    drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, scale: p.scale, moved: false };
    if (taps.length === 1) canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag || !e.isPrimary || taps.length !== 1) return;
    const p = toCanvas(e);
    drag.x1 = p.x; drag.y1 = p.y;
    drag.moved = Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0) * drag.scale > DRAG_MIN_CSS;
    render();
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!drag || !e.isPrimary) return;
    const d = drag; drag = null;
    if (d.moved && taps.length === 1) frame(d);
    else if (!d.moved) tap(d.x0, d.y0);
    else render();
  });
  canvas.addEventListener("pointercancel", () => { drag = null; render(); });

  // ---------- results ----------
  const quality = (s) => (s < 8 ? ["good", "jó egyezés"] : s < 13 ? ["mid", "közepes"] : ["weak", "gyenge"]);
  const sugarFree = (f) => f.note === "édesítőszerrel";
  const fullName = (f) => f.name + (sugarFree(f) ? " (cukormentes)" : "");
  const coatText = (f) => (f.coat === "nincs adat" ? "bevonat: nincs adat" : `${f.coat} bevonat`);

  function rawMeasurement() {
    if (profile) return { profile };
    return { samples: taps.slice(1).map((t) => M.correct(taps[0].linear, t.linear)), noSecond: noBand };
  }

  function showResults() {
    const raw = rawMeasurement(), m = calibrate(raw);
    const ranked = M.rank(F, m, { raw, own, allowed: allowed ? new Set(allowed) : undefined });
    if (!ranked.length) { toast("Nincs bepipált íz a Beállításokban."); return; }
    const conf = M.confidence(ranked);
    const calNote = cal ? " · kalibrálva" : "";
    const v = $("verdict");
    v.className = "verdict " + conf;
    v.innerHTML = conf === "high" ? `Szerintem ez: ${esc(fullName(ranked[0].flavour))}<small>Jó egyezés – azért nézd meg a fotót is.${calNote}</small>`
      : conf === "medium" ? `Valószínű találatok<small>Hasonlítsd össze a sztaniolt a lenti fotókkal.${calNote}</small>`
      : `Bizonytalan<small>Egyik szín sem stimmel igazán. Próbáld szórt fényben, nagyobb kerettel – vagy nézd végig a jelölteket.${calNote}</small>`;

    const mainLab = m.profile ? [m.profile[0].L, m.profile[0].a, m.profile[0].b] : m.samples[0];
    $("hits").innerHTML = ranked.slice(0, 3).map((r, i) => {
      const f = r.flavour, [cls, label] = quality(r.score);
      return `<article class="hit">
        <a href="${esc(f.photo)}" target="_blank" rel="noopener"><img src="${esc(f.photo)}" style="object-position:50% ${f.photoY}%" alt="${esc(f.name)} – webshop-fotó" loading="lazy" referrerpolicy="no-referrer"></a>
        <div>
          <div class="nm"><span class="rank">${i + 1}.</span>${esc(fullName(f))}${f.alcohol ? '<span class="alc" title="alkoholt tartalmaz">🍷</span>' : ""}<span class="tag ${cls}">${label}</span></div>
          <div class="meta">${esc(f.group)} · ${esc(coatText(f))}${f.note && !sugarFree(f) ? " · " + esc(f.note) : ""}</div>
          <div class="taste">${esc(f.texture)} – ${esc(f.main)}</div>
          <div class="cmp">mért <i style="background:${cssColor(mainLab)}"></i> webshop ${f.colors.map((c) => `<i style="background:${cssColor([c.L, c.a, c.b])}"></i>`).join("")}</div>
          <button class="btn small save" data-id="${f.id}">✓ Ez az – megjegyzem</button>
        </div></article>`;
    }).join("");
    $("moreHits").innerHTML = ranked.slice(3, 12).map((r, i) => {
      const f = r.flavour, [cls, label] = quality(r.score);
      return `<div class="row"><img src="${esc(f.photo)}" style="object-position:50% ${f.photoY}%" alt="" loading="lazy" referrerpolicy="no-referrer"><span style="flex:1">${i + 4}. ${esc(fullName(f))}</span><span class="tag ${cls}">${label}</span><button class="btn small save" style="width:auto;padding:4px 10px" data-id="${f.id}">✓</button></div>`;
    }).join("");
    show("results", true);
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function saveOwn(id) {
    const raw = rawMeasurement();
    const r1 = (v) => Math.round(v * 10) / 10;
    const cols = raw.profile ? raw.profile.map((c) => ({ L: r1(c.L), a: r1(c.a), b: r1(c.b), w: Math.round(c.w * 100) / 100 }))
      : raw.samples.map((s) => ({ L: r1(s[0]), a: r1(s[1]), b: r1(s[2]), w: 1 / raw.samples.length }));
    (own[id] = own[id] || []).push({ cols });
    store.set(OWN_KEY, own);
    const before = !!cal;
    refreshCalibration();
    toast(!before && cal ? "Megjegyeztem – a kalibráció mostantól aktív." : "Megjegyeztem ezen a telefonon – legközelebb ezt is figyelembe veszem.");
    updateOwnInfo();
  }

  // ---------- settings ----------
  function renderSettings() {
    const groups = [];
    F.forEach((f) => { let g = groups.find((x) => x.name === f.group); if (!g) groups.push(g = { name: f.group, items: [] }); g.items.push(f); });
    const on = (id) => !allowed || allowed.includes(id);
    $("flavourList").innerHTML = groups.map((g) => `<div class="grp"><h3>${esc(g.name)}</h3>${g.items.map((f) =>
      `<label><input type="checkbox" data-id="${f.id}" ${on(f.id) ? "checked" : ""}>${esc(fullName(f))}</label>`).join("")}</div>`).join("");
    $("useCal").checked = useCal;
    updateOwnInfo();
  }
  function readSettings() {
    const ids = [...document.querySelectorAll("#flavourList input")].filter((i) => i.checked).map((i) => Number(i.dataset.id));
    allowed = ids.length === F.length ? null : ids;
    store.set(ALLOWED_KEY, allowed);
    updateFilterInfo();
  }
  function updateFilterInfo() {
    $("filterInfo").textContent = allowed ? `Keresés: a bepipált ${allowed.length} íz közül (⚙ Beállítások)` : `Keresés: mind a ${F.length} íz közül (⚙ Beállítások)`;
  }
  function updateOwnInfo() {
    const n = ownCount(), k = Object.keys(own).length;
    const calText = !useCal ? "A kalibráció ki van kapcsolva."
      : cal ? "A kalibráció aktív: ezekből igazítja a telefon és a lámpák színeit a webshop-fotókhoz."
      : `A kalibrációhoz még ${Math.max(0, 3 - n)} megerősítés kell, legalább 2 különböző ízből.`;
    $("ownInfo").textContent = (n ? `${n} megerősített mérés ${k} ízhez. ` : "Még nincs megerősített mérés. ") + calText;
  }

  // ---------- events ----------
  $("camInput").addEventListener("change", onFile);
  $("galInput").addEventListener("change", onFile);
  $("noBandBtn").addEventListener("click", () => { noBand = true; render(); showResults(); });
  $("undoBtn").addEventListener("click", () => {
    if (profile) { profile = null; area = null; }
    else if (noBand) noBand = false;
    else taps.pop();
    $("warn").hidden = true; show("results", false); render();
  });
  const restart = () => { source = null; pixels = null; taps = []; area = null; profile = null; show("measure", false); show("results", false); show("start", true); window.scrollTo({ top: 0, behavior: "smooth" }); };
  $("newBtn").addEventListener("click", restart);
  $("againBtn").addEventListener("click", restart);
  document.addEventListener("click", (e) => { const b = e.target.closest(".save"); if (b) saveOwn(Number(b.dataset.id)); });
  $("settingsBtn").addEventListener("click", () => { renderSettings(); $("settings").showModal ? $("settings").showModal() : $("settings").setAttribute("open", ""); });
  $("closeSettings").addEventListener("click", () => { readSettings(); $("settings").close ? $("settings").close() : $("settings").removeAttribute("open"); if (done()) showResults(); });
  $("allBtn").addEventListener("click", () => document.querySelectorAll("#flavourList input").forEach((i) => (i.checked = true)));
  $("noneBtn").addEventListener("click", () => document.querySelectorAll("#flavourList input").forEach((i) => (i.checked = false)));
  $("useCal").addEventListener("change", (e) => { useCal = e.target.checked; store.set(CAL_KEY, useCal); refreshCalibration(); updateOwnInfo(); });
  $("clearOwn").addEventListener("click", () => { own = {}; store.set(OWN_KEY, own); refreshCalibration(); updateOwnInfo(); toast("Megerősítések törölve."); });
  refreshCalibration();
  updateFilterInfo();

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  // ---------- self-test: ?selftest=<id>[&mode=area] draws a synthetic candy under warm light and measures it ----------
  const params = new URLSearchParams(location.search), st = params.get("selftest");
  if (st) {
    const f = F.find((x) => x.id === Number(st)) || F[0];
    const cast = [0.95, 0.8, 0.55].map((v) => v * 0.7);
    const paint = (lin) => `rgb(${lin.map((v) => Math.round(255 * M.toSrgb(Math.max(0, Math.min(1, v))))).join(",")})`;
    const c = document.createElement("canvas"); c.width = 900; c.height = 600;
    const g = c.getContext("2d");
    g.fillStyle = "#5a5550"; g.fillRect(0, 0, 900, 600);
    g.fillStyle = paint(cast.map((v) => M.PAPER_WHITE * v)); g.fillRect(60, 220, 220, 160); g.fillRect(620, 220, 220, 160);
    g.fillStyle = paint(M.labToLinear([f.colors[0].L, f.colors[0].a, f.colors[0].b]).map((v, i) => v * cast[i])); g.fillRect(280, 170, 340, 260);
    const band = f.colors.slice(1).find((x) => x.w >= 0.2 && M.distinctColors([x.L, x.a, x.b], [f.colors[0].L, f.colors[0].a, f.colors[0].b]));
    if (band) { g.fillStyle = paint(M.labToLinear([band.L, band.a, band.b]).map((v, i) => v * cast[i])); g.fillRect(400, 170, 100, 260); }
    setPhoto(c, 900, 600);
    tap(150, 300);
    if (params.get("mode") === "area") frame({ x0: 250, y0: 190, x1: 640, y1: 410 });
    else { tap(330, 300); if (band) tap(450, 300); else { noBand = true; render(); showResults(); } }
  }
})();
