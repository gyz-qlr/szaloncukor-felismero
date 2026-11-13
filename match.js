// Colour maths and matching for the szaloncukor recogniser. No network, no AI: plain colour distances.
// Works in the browser (window.Match) and in Node (module.exports) so the same code can be tested.
(function (root) {
  "use strict";

  // Paper white of the studio photos the references were measured on (CIELAB L 94.4 -> linear 0.862).
  const PAPER_WHITE = 0.862;
  // Lightness counts half: on shiny foil it swings with the light angle much more than hue does.
  const K_L = 2;
  // Penalty for matching a minor colour of a wrapper (e.g. a thin band) instead of its main colour.
  const MINOR_PENALTY = 8;

  const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const toSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const LINEAR_8BIT = Array.from({ length: 256 }, (_, i) => toLinear(i / 255));

  function linearToLab([r, g, b]) {
    let x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    [x, y, z] = [f(x), f(y), f(z)];
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }

  function labToLinear([L, a, b]) {
    const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    const inv = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
    const x = inv(fx) * 0.95047, y = inv(fy), z = inv(fz) * 1.08883;
    return [3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z, 0.0557 * x - 0.204 * y + 1.057 * z];
  }

  // CIEDE2000 colour difference with a lightness weight kL.
  function deltaE([L1, a1, b1], [L2, a2, b2], kL = K_L) {
    const rad = Math.PI / 180;
    const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
    const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
    const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
    const h = (bb, ap) => (bb === 0 && ap === 0 ? 0 : (Math.atan2(bb, ap) / rad + 360) % 360);
    const h1 = h(b1, a1p), h2 = h(b2, a2p);
    let dh = 0;
    if (C1p * C2p !== 0) dh = Math.abs(h2 - h1) <= 180 ? h2 - h1 : h2 > h1 ? h2 - h1 - 360 : h2 - h1 + 360;
    const dL = L2 - L1, dC = C2p - C1p, dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * rad);
    const Lm = (L1 + L2) / 2, Cm = (C1p + C2p) / 2;
    let hm = h1 + h2;
    if (C1p * C2p !== 0) hm = Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
    const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
    const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2), SC = 1 + 0.045 * Cm, SH = 1 + 0.015 * Cm * T;
    const RT = -2 * Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad);
    const l = dL / (kL * SL), c = dC / SC, hh = dH / SH;
    return Math.sqrt(l * l + c * c + hh * hh + RT * c * hh);
  }

  // Average of a set of linear RGB pixels: the brighter half for paper (minus the very top, which may be
  // clipped), the middle for foil (drops glints and the darkest folds).
  function robustMean(pixels, kind) {
    const lum = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    const s = pixels.slice().sort((p, q) => lum(p) - lum(q));
    const lo = kind === "paper" ? Math.floor(s.length * 0.5) : Math.floor(s.length * 0.1);
    const hi = kind === "paper" ? Math.ceil(s.length * 0.95) : Math.ceil(s.length * 0.85);
    const part = s.slice(lo, Math.max(hi, lo + 1));
    const m = [0, 0, 0];
    part.forEach((p) => { m[0] += p[0]; m[1] += p[1]; m[2] += p[2]; });
    return m.map((v) => v / part.length);
  }

  // White-balance and exposure correction: scale each channel so the tapped paper reads as studio-paper white.
  function correct(paper, foil) {
    return linearToLab(foil.map((v, i) => Math.min(1, (v * PAPER_WHITE) / Math.max(paper[i], 1e-4))));
  }

  // Would a person call these two different colours (a band on the wrapper), not just the light and dark
  // side of one foil? Decided on chroma and hue; lightness alone only counts between greys/black.
  function distinctColors([L1, a1, b1], [L2, a2, b2]) {
    const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
    if (C1 < 10 && C2 < 10) return Math.abs(L1 - L2) > 30;
    if (Math.min(C1, C2) < 10) return Math.max(C1, C2) > 20;
    let dh = Math.abs(Math.atan2(b1, a1) - Math.atan2(b2, a2)) * 180 / Math.PI;
    if (dh > 180) dh = 360 - dh;
    return Math.abs(C1 - C2) > 15 || dh > 30;
  }

  const lab = (c) => [c.L, c.a, c.b];
  const cost = (sample, c) => deltaE(sample, lab(c)) + MINOR_PENALTY * (1 - Math.min(1, c.w / 0.5));

  // ---------- wrapper colours of a framed area ----------
  // k-means in Lab with lightness at half weight, started from spread-out points so the result is repeatable.
  function kmeans(pts, k, iters = 15) {
    const dist = (p, q) => ((p[0] - q[0]) * 0.5) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
    const step = Math.max(1, Math.floor(pts.length / 1500));
    const pool = pts.filter((_, i) => i % step === 0);
    const byL = pool.slice().sort((p, q) => p[0] - q[0]);
    const cen = [byL[Math.floor(byL.length / 2)].slice()];
    while (cen.length < k) {
      let far = pool[0], fd = -1;
      pool.forEach((p) => { const d = Math.min(...cen.map((c) => dist(p, c))); if (d > fd) { fd = d; far = p; } });
      cen.push(far.slice());
    }
    let label = new Array(pts.length).fill(0);
    for (let it = 0; it < iters; it++) {
      const sum = cen.map(() => [0, 0, 0, 0]);
      pts.forEach((p, i) => {
        let best = 0, bd = Infinity;
        for (let j = 0; j < cen.length; j++) { const d = dist(p, cen[j]); if (d < bd) { bd = d; best = j; } }
        label[i] = best;
        const s = sum[best]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
      });
      sum.forEach((s, j) => { if (s[3]) cen[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
    }
    const n = cen.map(() => 0);
    label.forEach((l) => n[l]++);
    return cen.map((c, j) => ({ L: c[0], a: c[1], b: c[2], w: n[j] / pts.length })).filter((c) => c.w > 0);
  }

  // Colours of the wrapper inside the user's frame, with their share of the area. Same recipe as the
  // reference colours: paper, glints and the darkest shadow left out; the light and dark side of one foil
  // merged; small light-grey patches (paper of the next candy) dropped.
  function extractProfile(pixels, paper) {
    const pts = [];
    for (const p of pixels) {
      if (Math.max(p[0], p[1], p[2]) >= 0.985) continue; // clipped glint
      const c = correct(paper, p);
      if (c[0] < 8 || (c[0] > 86 && Math.hypot(c[1], c[2]) < 8)) continue;
      pts.push(c);
    }
    if (pts.length < 150) return null;
    let cols = kmeans(pts, 4);
    for (let merged = true; merged;) {
      merged = false;
      outer: for (let i = 0; i < cols.length; i++) {
        for (let j = i + 1; j < cols.length; j++) {
          if (deltaE(lab(cols[i]), lab(cols[j])) < 10) {
            const wi = cols[i].w, wj = cols[j].w, w = wi + wj;
            cols[i] = { L: (cols[i].L * wi + cols[j].L * wj) / w, a: (cols[i].a * wi + cols[j].a * wj) / w, b: (cols[i].b * wi + cols[j].b * wj) / w, w };
            cols.splice(j, 1);
            merged = true;
            break outer;
          }
        }
      }
    }
    cols.sort((p, q) => q.w - p.w);
    cols = cols.slice(0, 1).concat(cols.slice(1).filter((c) => c.w >= 0.1 && !(c.L > 58 && Math.hypot(c.a, c.b) < 14 && c.w < 0.2)));
    const tot = cols.reduce((s, c) => s + c.w, 0);
    return cols.map((c) => ({ L: c.L, a: c.a, b: c.b, w: c.w / tot }));
  }

  // ---------- scoring ----------
  // Point mode. samples = 1 or 2 corrected Lab colours; noSecond = the user said the wrapper has no other
  // colour (band/label). Lower is better.
  function scoreColors(colors, samples, noSecond) {
    if (samples.length === 1) {
      let best = Infinity, bestIdx = 0;
      colors.forEach((c, i) => { const d = cost(samples[0], c); if (d < best) { best = d; bestIdx = i; } });
      if (noSecond) {
        // a wrapper with a clearly different second colour that the user did not see is less likely
        const other = colors.filter((c, i) => i !== bestIdx && c.w >= 0.2 && distinctColors(lab(c), lab(colors[bestIdx])));
        if (other.length) best += 6;
      }
      return best;
    }
    // two clearly different tapped colours should land on two different colours of the wrapper
    const distinct = distinctColors(samples[0], samples[1]);
    let best = Infinity;
    colors.forEach((ci, i) => colors.forEach((cj, j) => {
      best = Math.min(best, (cost(samples[0], ci) + cost(samples[1], cj)) / 2 + (i === j && distinct ? 6 : 0));
    }));
    return best;
  }

  // Area mode: every measured colour should exist on the wrapper, and every sizeable wrapper colour
  // should show up in the measurement (each side weighted by area share).
  function scoreProfile(colors, profile) {
    let d1 = 0;
    profile.forEach((s) => { d1 += s.w * Math.min(...colors.map((r) => deltaE(lab(s), lab(r)))); });
    let d2 = 0, ws = 0;
    colors.forEach((r) => {
      if (r.w < 0.15) return;
      d2 += r.w * Math.min(...profile.map((s) => deltaE(lab(r), lab(s))));
      ws += r.w;
    });
    return (d1 + (ws ? d2 / ws : 0)) / 2;
  }

  // measurement = {profile} (area) or {samples, noSecond} (points), already calibrated for the web references;
  // raw = the same before calibration, compared with colours saved on this phone (own = {id: [{cols}]}).
  function score(colors, m) {
    return m.profile ? scoreProfile(colors, m.profile) : scoreColors(colors, m.samples, m.noSecond);
  }

  function rank(flavours, m, opts = {}) {
    const own = opts.own || {}, raw = opts.raw || m, allowed = opts.allowed;
    return flavours
      .filter((f) => !allowed || allowed.has(f.id))
      .map((f) => {
        let s = score(f.colors, m);
        (own[f.id] || []).forEach((e) => {
          const cols = raw.profile ? e.cols : e.cols.map((c) => ({ ...c, w: 1 }));
          s = Math.min(s, score(cols, raw));
        });
        return { flavour: f, score: s };
      })
      .sort((p, q) => p.score - q.score);
  }

  // How sure the top hit is, from its score and the gap to the runner-up.
  function confidence(ranked) {
    if (!ranked.length) return "none";
    const b = ranked[0].score, gap = ranked.length > 1 ? ranked[1].score - b : 99;
    if (b < 8 && gap >= 4) return "high";
    if (b < 13) return "medium";
    return "low";
  }

  // ---------- calibration learnt from confirmed measurements ----------
  // Model: L' = al*L + bl; (a', b') = scale-and-rotate (p, q) + shift (ta, tb). Pulled towards "no change"
  // by a few identity points so that two or three confirmations cannot bend it too far.
  function solve(A, y) {
    const n = y.length, M = A.map((r, i) => r.concat(y[i]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      if (Math.abs(M[c][c]) < 1e-12) return null;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((r, i) => r[n] / r[i]);
  }

  function fitCalibration(pairs) {
    if (pairs.length < 3) return null;
    const prior = [];
    [20, 50, 80].forEach((L) => [[0, 0], [30, 0], [0, 30], [-30, 0], [0, -30]].forEach(([a, b]) => prior.push({ m: [L, a, b], r: [L, a, b], w: 0.05 })));
    const all = pairs.concat(prior);
    // lightness: weighted least squares for (al, bl)
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    all.forEach(({ m, r, w }) => { sw += w; sx += w * m[0]; sy += w * r[0]; sxx += w * m[0] * m[0]; sxy += w * m[0] * r[0]; });
    const al = (sw * sxy - sx * sy) / (sw * sxx - sx * sx), bl = (sy - al * sx) / sw;
    // colour: a' = p a - q b + ta, b' = q a + p b + tb
    const N = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], v = [0, 0, 0, 0];
    all.forEach(({ m, r, w }) => {
      const rows = [[[m[1], -m[2], 1, 0], r[1]], [[m[2], m[1], 0, 1], r[2]]];
      rows.forEach(([x, t]) => { for (let i = 0; i < 4; i++) { v[i] += w * x[i] * t; for (let j = 0; j < 4; j++) N[i][j] += w * x[i] * x[j]; } });
    });
    const s = solve(N, v);
    if (!s || !isFinite(al)) return null;
    const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
    const scale = clamp(Math.hypot(s[0], s[1]), 0.7, 1.4), ang = clamp(Math.atan2(s[1], s[0]), -0.44, 0.44);
    return { al: clamp(al, 0.7, 1.4), bl: clamp(bl, -20, 20), p: scale * Math.cos(ang), q: scale * Math.sin(ang),
      ta: clamp(s[2], -15, 15), tb: clamp(s[3], -15, 15), n: pairs.length };
  }

  function applyCalibration(cal, [L, a, b]) {
    if (!cal) return [L, a, b];
    return [cal.al * L + cal.bl, cal.p * a - cal.q * b + cal.ta, cal.q * a + cal.p * b + cal.tb];
  }

  // Pairs (measured -> reference colour) from the confirmations saved on this phone. Each measured colour is
  // paired with the nearest colour of the confirmed flavour; far-off ones (a mis-confirmation) are skipped.
  function calibrationPairs(flavours, own) {
    const pairs = [];
    let flavoursUsed = 0;
    Object.entries(own).forEach(([id, entries]) => {
      const f = flavours.find((x) => x.id === Number(id));
      if (!f) return;
      flavoursUsed++;
      entries.forEach((e) => e.cols.forEach((c) => {
        let best = null, bd = Infinity;
        f.colors.forEach((r) => { const d = deltaE(lab(c), lab(r)); if (d < bd) { bd = d; best = r; } });
        if (bd < 25) pairs.push({ m: lab(c), r: lab(best), w: c.w });
      }));
    });
    return flavoursUsed >= 2 ? pairs : [];
  }

  const api = { PAPER_WHITE, LINEAR_8BIT, toLinear, toSrgb, linearToLab, labToLinear, deltaE, distinctColors, robustMean,
    correct, extractProfile, scoreColors, scoreProfile, rank, confidence, fitCalibration, applyCalibration, calibrationPairs };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Match = api;
})(typeof window !== "undefined" ? window : globalThis);
