// Szaloncukor-felismerő: photo -> tap paper + foil -> white-balanced colour -> ranked flavours.
(function () {
  "use strict";
  const F = window.SZALONCUKROK;
  const M = window.Match;
  const $ = (id) => document.getElementById(id);
  const OWN_KEY = "szc_own_v1", ALLOWED_KEY = "szc_allowed_v1";
  const MAX_SIDE = 1600;

  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode: keep in memory only */ } },
  };
  let own = store.get(OWN_KEY, {});
  let allowed = store.get(ALLOWED_KEY, null); // null = all flavours

  // ---------- state ----------
  const canvas = $("photo"), ctx = canvas.getContext("2d");
  let source = null, pixels = null, radius = 8;
  let taps = []; // {x, y, kind: "paper"|"foil", linear}
  let noBand = false;

  const STEPS = [
    ["Koppints a fehér papírvégre", "Ebből igazítja a színeket a fényviszonyokhoz."],
    ["Koppints a sztaniol fő színére", "Ne a csillogó vagy a nagyon sötét részre."],
    ["Van más színű sáv vagy címke? Koppints rá", "Ha nincs, nyomd meg: „Nincs más színe”."],
  ];

  function show(id, on) { $(id).hidden = !on; }
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2200); }
  function cssColor(lab) {
    const rgb = M.labToLinear(lab).map((v) => Math.round(255 * M.toSrgb(Math.max(0, Math.min(1, v)))));
    return `rgb(${rgb.join(",")})`;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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
    taps = []; noBand = false;
    show("start", false); show("measure", true); show("results", false);
    render();
    $("measure").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- sampling ----------
  function sampleAt(x, y, kind) {
    const { width: w, height: h, data } = pixels, out = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const px = x + dx, py = y + dy;
        if (dx * dx + dy * dy > radius * radius || px < 0 || py < 0 || px >= w || py >= h) continue;
        const i = (py * w + px) * 4;
        out.push([M.toLinear(data[i] / 255), M.toLinear(data[i + 1] / 255), M.toLinear(data[i + 2] / 255)]);
      }
    }
    return M.robustMean(out, kind);
  }

  function correctedSamples() {
    const paper = taps[0].linear;
    return taps.slice(1).map((t) => M.correct(paper, t.linear));
  }

  function tap(x, y) {
    if (!pixels || taps.length >= 3 || (taps.length === 2 && noBand)) return;
    const kind = taps.length === 0 ? "paper" : "foil";
    const linear = sampleAt(x, y, kind);
    $("warn").hidden = true;
    if (kind === "paper") {
      const lum = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
      if (lum < 0.04) return warn("Ez túl sötét a papírhoz. Koppints a szaloncukor fehér papírvégére.");
      if (Math.max(...linear) > 0.985) warn("A papír beégett (túl világos) – a mérés így is működik, de pontosabb, ha kevésbé erős fényben fotózol.", true);
    } else {
      const lab = M.correct(taps[0].linear, linear);
      if (lab[0] > 90 && Math.hypot(lab[1], lab[2]) < 8) return warn("Ez a papírnak tűnik. Koppints a színes sztaniolra.");
    }
    taps.push({ x, y, kind, linear });
    render();
    if (taps.length === 3) showResults();
  }

  function warn(msg, soft) { const w = $("warn"); w.textContent = msg; w.hidden = false; if (!soft) render(); }

  // ---------- drawing ----------
  function render() {
    if (!source) return;
    ctx.drawImage(source, 0, 0);
    const lw = Math.max(2, Math.round(canvas.width / 300));
    taps.forEach((t, i) => {
      ctx.lineWidth = lw * 2; ctx.strokeStyle = "rgba(0,0,0,.7)";
      ctx.beginPath(); ctx.arc(t.x, t.y, radius + lw * 2, 0, 2 * Math.PI); ctx.stroke();
      ctx.lineWidth = lw; ctx.strokeStyle = i === 0 ? "#fff" : "#ffd36b";
      ctx.beginPath(); ctx.arc(t.x, t.y, radius + lw * 2, 0, 2 * Math.PI); ctx.stroke();
      ctx.font = `700 ${radius * 2 + 6}px "Noto Sans", sans-serif`;
      ctx.lineWidth = lw * 2; ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.fillStyle = "#fff";
      const label = i === 0 ? "P" : String(i);
      ctx.strokeText(label, t.x + radius + lw * 4, t.y - radius); ctx.fillText(label, t.x + radius + lw * 4, t.y - radius);
    });
    const step = Math.min(taps.length, 2);
    const done = taps.length === 3 || (taps.length === 2 && noBand);
    $("stepNum").textContent = done ? "✓" : String(step + 1);
    $("stepText").innerHTML = done ? "Kész – az eredmény lent látható.<span class=\"hint\">Új méréshez: Vissza vagy Új fotó.</span>"
      : `${STEPS[step][0]}<span class="hint">${STEPS[step][1]}</span>`;
    show("noBandBtn", taps.length === 2 && !noBand);
    const sw = [];
    if (taps.length) {
      correctedSamples().forEach((lab, i) => sw.push(`<span class="chip"><i style="background:${cssColor(lab)}"></i>${i === 0 ? "fő szín" : "sáv/címke"}</span>`));
      if (taps.length === 1) sw.unshift(`<span class="chip"><i style="background:#fff"></i>papír rögzítve</span>`);
    }
    $("swatches").innerHTML = sw.join("");
  }

  // ---------- results ----------
  const quality = (s) => (s < 8 ? ["good", "jó egyezés"] : s < 13 ? ["mid", "közepes"] : ["weak", "gyenge"]);
  const sugarFree = (f) => f.note === "édesítőszerrel";
  const fullName = (f) => f.name + (sugarFree(f) ? " (cukormentes)" : "");
  const coatText = (f) => (f.coat === "nincs adat" ? "bevonat: nincs adat" : `${f.coat} bevonat`);

  function showResults() {
    const samples = correctedSamples();
    const ranked = M.rank(F, samples, { noSecond: noBand, own, allowed: allowed ? new Set(allowed) : undefined });
    if (!ranked.length) { toast("Nincs bepipált íz a Beállításokban."); return; }
    const conf = M.confidence(ranked);
    const v = $("verdict");
    v.className = "verdict " + conf;
    v.innerHTML = conf === "high" ? `Szerintem ez: ${esc(fullName(ranked[0].flavour))}<small>Jó egyezés – azért nézd meg a fotót is.</small>`
      : conf === "medium" ? "Valószínű találatok<small>Hasonlítsd össze a sztaniolt a lenti fotókkal.</small>"
      : "Bizonytalan<small>Egyik szín sem stimmel igazán. Próbáld szórt fényben, a sáv koppintásával – vagy nézd végig a jelölteket.</small>";

    $("hits").innerHTML = ranked.slice(0, 3).map((r, i) => {
      const f = r.flavour, [cls, label] = quality(r.score);
      return `<article class="hit">
        <a href="${esc(f.photo)}" target="_blank" rel="noopener"><img src="${esc(f.photo)}" style="object-position:50% ${f.photoY}%" alt="${esc(f.name)} – webshop-fotó" loading="lazy" referrerpolicy="no-referrer"></a>
        <div>
          <div class="nm"><span class="rank">${i + 1}.</span>${esc(fullName(f))}${f.alcohol ? '<span class="alc" title="alkoholt tartalmaz">🍷</span>' : ""}<span class="tag ${cls}">${label}</span></div>
          <div class="meta">${esc(f.group)} · ${esc(coatText(f))}${f.note && !sugarFree(f) ? " · " + esc(f.note) : ""}</div>
          <div class="taste">${esc(f.texture)} – ${esc(f.main)}</div>
          <div class="cmp">mért <i style="background:${cssColor(samples[0])}"></i> webshop <i style="background:${cssColor([f.colors[0].L, f.colors[0].a, f.colors[0].b])}"></i></div>
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
    const set = correctedSamples().map((lab) => lab.map((v) => Math.round(v * 10) / 10));
    (own[id] = own[id] || []).push(set);
    store.set(OWN_KEY, own);
    toast("Megjegyeztem ezen a telefonon – legközelebb ezt is figyelembe veszem.");
    updateOwnInfo();
  }

  // ---------- settings ----------
  function renderSettings() {
    const groups = [];
    F.forEach((f) => { let g = groups.find((x) => x.name === f.group); if (!g) groups.push(g = { name: f.group, items: [] }); g.items.push(f); });
    const on = (id) => !allowed || allowed.includes(id);
    $("flavourList").innerHTML = groups.map((g) => `<div class="grp"><h3>${esc(g.name)}</h3>${g.items.map((f) =>
      `<label><input type="checkbox" data-id="${f.id}" ${on(f.id) ? "checked" : ""}>${esc(fullName(f))}</label>`).join("")}</div>`).join("");
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
    const n = Object.values(own).reduce((s, v) => s + v.length, 0);
    $("ownInfo").textContent = n ? `${n} megjegyzett mérés ${Object.keys(own).length} ízhez – ezeket is figyelembe veszi.` : "Még nincs megjegyzett mérés.";
  }

  // ---------- events ----------
  $("camInput").addEventListener("change", onFile);
  $("galInput").addEventListener("change", onFile);
  canvas.addEventListener("click", (e) => {
    const r = canvas.getBoundingClientRect();
    tap(Math.round((e.clientX - r.left) * canvas.width / r.width), Math.round((e.clientY - r.top) * canvas.height / r.height));
  });
  $("noBandBtn").addEventListener("click", () => { noBand = true; render(); showResults(); });
  $("undoBtn").addEventListener("click", () => { if (noBand) noBand = false; else taps.pop(); $("warn").hidden = true; show("results", false); render(); });
  const restart = () => { source = null; pixels = null; taps = []; show("measure", false); show("results", false); show("start", true); window.scrollTo({ top: 0, behavior: "smooth" }); };
  $("newBtn").addEventListener("click", restart);
  $("againBtn").addEventListener("click", restart);
  document.addEventListener("click", (e) => { const b = e.target.closest(".save"); if (b) saveOwn(Number(b.dataset.id)); });
  $("settingsBtn").addEventListener("click", () => { renderSettings(); $("settings").showModal ? $("settings").showModal() : $("settings").setAttribute("open", ""); });
  $("closeSettings").addEventListener("click", () => { readSettings(); $("settings").close ? $("settings").close() : $("settings").removeAttribute("open"); });
  $("allBtn").addEventListener("click", () => document.querySelectorAll("#flavourList input").forEach((i) => (i.checked = true)));
  $("noneBtn").addEventListener("click", () => document.querySelectorAll("#flavourList input").forEach((i) => (i.checked = false)));
  $("clearOwn").addEventListener("click", () => { own = {}; store.set(OWN_KEY, own); updateOwnInfo(); toast("Saját minták törölve."); });
  updateFilterInfo();

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  // ---------- self-test: ?selftest=<id> draws a synthetic candy under warm light and taps it ----------
  const st = new URLSearchParams(location.search).get("selftest");
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
    tap(150, 300); tap(330, 300);
    if (band) tap(450, 300); else { noBand = true; render(); showResults(); }
  }
})();
