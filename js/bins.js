// Bins vs. bumps tab: the same n samples from a hidden true pdf, estimated
// by a histogram (bin count and shift) above and a KDE (kernel and h)
// below, on one y scale, each scored by its distance from the truth.

const V_W = 900;
const V_HIST = { x0: 64, x1: 884, y0: 34, y1: 266 };
const V_KDE = { x0: 64, x1: 884, y0: 336, y1: 568 };

const V = {
  truth: "humps",
  n: 1000,
  seed: 1,
  data: [],
  bins: 30,
  off: 0,
  h: .4,
  kern: "gaussian",
  truthOn: true,
};

const vSvg = document.getElementById("v-plot");

/**
 * Histogram of V.data as a density.
 *
 * Bin j covers [lo + (j + off) w, lo + (j + 1 + off) w), lo the left end
 * of the plotted range and w = range / bins.
 *
 * Returns:
 *   w (number): bin width
 *   dens (Map): bin index j -> count / (n w)
 *   at (Function): x -> histogram density at x
 */
function vHist() {
  const T = TRUTHS[V.truth], lo = T.dom[0];
  const w = (T.dom[1] - lo) / V.bins, n = V.data.length;
  const bin = x => Math.floor((x - lo) / w - V.off);
  const dens = new Map();
  for (const x of V.data) {
    const j = bin(x);
    dens.set(j, (dens.get(j) || 0) + 1 / (n * w));
  }
  return { w, dens, at: x => dens.get(bin(x)) || 0, edge: j => lo + (j + V.off) * w };
}

/**
 * Distance from the truth, ½∫|p̂ − p| dx (total variation, in [0, 1]).
 *
 * Quadrature fine enough to see a bump of width h.
 */
function vErr(pHatOn, h) {
  const T = TRUTHS[V.truth];
  const lo = Math.min(T.grid[0], Math.min(...V.data) - 6 * h);
  const hi = Math.max(T.grid[1], Math.max(...V.data) + 6 * h);
  const m = Math.round(clamp((hi - lo) / (h / 4), 1500, 6000));
  const xs = linspace(lo, hi, m);
  const ph = pHatOn(xs);
  return .5 * trapz(xs, xs.map((x, j) => Math.abs(ph[j] - T.pdf(x))));
}

function vDraw() {
  V.data = drawTruth(V.truth, V.n, V.seed);
}

const vSetTruth = segmented(document.getElementById("v-truths"),
  Object.entries(TRUTHS).map(([k, t]) => [k, t.label]),
  k => { V.truth = k; vSetTruth(k); vDraw(); vRender(); });
const vSetKern = segmented(document.getElementById("v-kern"),
  KERNEL_ORDER.map(k => [k, KERNELS[k].label]),
  k => { V.kern = k; vSetKern(k); vRender(); });
const vSetN = sliderPair("v-nr", "v-n", 20, 2000, v => {
  V.n = Math.round(v); vDraw(); vRender(); }, true);
const vSetB = sliderPair("v-br", "v-b", 2, 200, v => {
  V.bins = Math.round(v); vRender(); }, true);
const vSetO = sliderPair("v-or", "v-o", 0, .99, v => {
  V.off = v; vRender(); });
const vSetH = sliderPair("v-hr", "v-h", .01, 3, v => {
  V.h = v; vRender(); }, true);

document.getElementById("v-new").onclick = () => {
  V.seed++; vDraw(); vRender();
};
document.getElementById("v-truth").onchange = e => {
  V.truthOn = e.target.checked; vRender();
};
document.getElementById("v-scott").onclick = () => {
  V.h = scottH(V.data); vSetH(V.h); vRender();
};
document.getElementById("v-match").onclick = () => {
  V.kern = "tophat";
  V.h = vHist().w / 2;
  vSetKern(V.kern);
  vSetH(V.h);
  vRender();
};

/** SVG rug of V.data along the bottom of frame F. */
function vRug(F) {
  let d = "";
  for (const x of V.data) {
    if (x < F.xd[0] || x > F.xd[1]) continue;
    d += `M${F.sx(x).toFixed(1)},${F.box.y1}v-9`;
  }
  return `<path class="rug" d="${d}"/>`;
}

function vRender() {
  const T = TRUTHS[V.truth], xs = linspace(T.dom[0], T.dom[1], 700);
  const H = vHist(), pk = kdePdf(V.data, V.h, V.kern, xs);
  const pt = xs.map(T.pdf);
  const tmax = Math.max(...pt);
  const hmax = Math.max(...H.dens.values());
  const all = Math.max(tmax, hmax, ...pk);
  const cap = 2.4 * tmax, top = niceUp(1.08 * Math.min(all, cap));
  const Fh = frame(V_HIST, T.dom, [0, top]);
  const eh = vErr(x => x.map(H.at), H.w);
  const ek = vErr(x => kdePdf(V.data, V.h, V.kern, x), V.h);
  const Fk = frame(V_KDE, T.dom, [0, top]);
  const ylab = `density`;

  let s = axesSvg(Fh, { clip: "v-clip-h", ylabel: ylab });
  s += `<g clip-path="url(#v-clip-h)">`;
  for (const [j, f] of H.dens) {
    const a = Fh.sx(H.edge(j)), b = Fh.sx(H.edge(j + 1)), y = Fh.sy(f);
    s += `<rect class="hbar" x="${a.toFixed(1)}" y="${y.toFixed(1)}"
      width="${Math.max(b - a, .5).toFixed(1)}" height="${
      (Fh.box.y1 - y).toFixed(1)}"/>`;
  }
  if (V.truthOn) s += `<path class="truth" d="${pathD(Fh, xs, pt)}"/>`;
  s += vRug(Fh) + `</g>`;
  s += `<text class="ptitle" x="${V_HIST.x0}" y="${V_HIST.y0 - 12}">Histogram:
    ${V.bins} bins of width <tspan class="sym">w</tspan> = ${fmtH(H.w)}${
    hmax > cap ? ' <tspan class="clip">(tallest bars cut off)</tspan>' : ""}</text>
    <text class="perr" x="${V_HIST.x1}" y="${V_HIST.y0 - 12}" text-anchor="end"
      >distance from the truth ${fmt(eh, 3)}</text>`;

  s += axesSvg(Fk, { clip: "v-clip-k", ylabel: ylab,
    xlabel: `<tspan class="sym">x</tspan>` });
  s += `<g clip-path="url(#v-clip-k)"><path class="kfill" d="${
    bandD(Fk, xs, new Float64Array(xs.length), pk)}"/><path class="kline" d="${
    pathD(Fk, xs, pk)}"/>`;
  if (V.truthOn) s += `<path class="truth" d="${pathD(Fk, xs, pt)}"/>`;
  s += vRug(Fk) + `</g>`;
  s += `<text class="ptitle" x="${V_KDE.x0}" y="${V_KDE.y0 - 12}">KDE:
    ${KERNELS[V.kern].label} kernel, <tspan class="sym">h</tspan> = ${
    fmtH(V.h)}${Math.max(...pk) > cap ?
    ' <tspan class="clip">(tallest peaks cut off)</tspan>' : ""}</text>
    <text class="perr" x="${V_KDE.x1}" y="${V_KDE.y0 - 12}" text-anchor="end"
      >distance from the truth ${fmt(ek, 3)}</text>`;
  vSvg.innerHTML = s;

  const better = (a, b) => a <= b ? ` class="good"` : "";
  document.getElementById("v-hread").innerHTML =
    row("bin width <i>w</i>", fmtH(H.w)) +
    row("distance from the truth", `<span${better(eh, ek)}>${fmt(eh, 3)}</span>`);
  document.getElementById("v-kread").innerHTML =
    row("bandwidth <i>h</i>", fmtH(V.h)) +
    row("Scott's rule &sigma;<i>n</i><sup>&minus;1/5</sup>", fmtH(scottH(V.data))) +
    row("distance from the truth", `<span${better(ek, eh)}>${fmt(ek, 3)}</span>`);
}

function binsShow() {
  if (!V.data.length) vDraw();
  vSetTruth(V.truth);
  vSetKern(V.kern);
  vSetN(V.n);
  vSetB(V.bins);
  vSetO(V.off);
  vSetH(V.h);
  document.getElementById("v-truth").checked = V.truthOn;
  vRender();
}
