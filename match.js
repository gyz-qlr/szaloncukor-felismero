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

  // Average of a set of linear RGB pixels: the brightest half for paper, the middle for foil
  // (drops glints and the darkest folds).
  function robustMean(pixels, kind) {
    const lum = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    const s = pixels.slice().sort((p, q) => lum(p) - lum(q));
    const lo = kind === "paper" ? Math.floor(s.length / 2) : Math.floor(s.length * 0.1);
    const hi = kind === "paper" ? s.length : Math.ceil(s.length * 0.85);
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

  const refLab = (c) => [c.L, c.a, c.b];
  const cost = (sample, c) => deltaE(sample, refLab(c)) + MINOR_PENALTY * (1 - Math.min(1, c.w / 0.5));

  // Score of one flavour: lower is better. samples = 1 or 2 corrected Lab colours;
  // noSecond = the user said the wrapper has no other colour (band/label).
  function scoreColors(colors, samples, noSecond) {
    if (samples.length === 1) {
      let best = Infinity, bestIdx = 0;
      colors.forEach((c, i) => { const d = cost(samples[0], c); if (d < best) { best = d; bestIdx = i; } });
      if (noSecond) {
        // a wrapper with a clearly different second colour that the user did not see is less likely
        const other = colors.filter((c, i) => i !== bestIdx && c.w >= 0.2 && distinctColors(refLab(c), refLab(colors[bestIdx])));
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

  // Rank flavours; own = {flavourId: [[Lab, Lab?], ...]} colours saved on this phone, used as extra references.
  function rank(flavours, samples, opts = {}) {
    const own = opts.own || {};
    const allowed = opts.allowed; // Set of ids or undefined = all
    return flavours
      .filter((f) => !allowed || allowed.has(f.id))
      .map((f) => {
        let s = scoreColors(f.colors, samples, opts.noSecond);
        (own[f.id] || []).forEach((set) => {
          const cols = set.map((lab) => ({ L: lab[0], a: lab[1], b: lab[2], w: 1 }));
          s = Math.min(s, scoreColors(cols, samples, opts.noSecond));
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

  const api = { PAPER_WHITE, toLinear, toSrgb, linearToLab, labToLinear, deltaE, distinctColors, robustMean, correct, scoreColors, rank, confidence };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Match = api;
})(typeof window !== "undefined" ? window : globalThis);
