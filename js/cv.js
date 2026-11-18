// Choosing-h tab: samples from a hidden true pdf, p̂ at the chosen h on
// top, and below every h scored three ways: on the training samples
// themselves, by k-fold cross-validation (held-out mean ln p̂), and on new
// data from the truth (knowable here only because the truth is known).

const C_HS = geomspace(.002, 5, 91);
const C_TOP = { x0: 64, x1: 884, y0: 16, y1: 262 };
const C_CH = { x0: 64, x1: 884, y0: 22, y1: 300 };

const C = {
  truth: "humps",
  n: 300,
  seed: 1,
  k: 5,
  kern: "gaussian",
  h: null,
  fold: -1,
  truthOn: true,
  newOn: true,
  data: [],
  folds: null,
  cur: null,
  scott: NaN,
  best: NaN,
};
let C_F = null;

const cTop = document.getElementById("c-plot");
const cChart = document.getElementById("c-chart");

/** Redraw the samples and folds, then rescore every h. */
function cRecompute(resetH) {
  C.data = drawTruth(C.truth, C.n, C.seed + 100);
  C.folds = foldIds(C.n, C.k, C.seed);
  C.fold = Math.min(C.fold, C.k - 1);
  const cv = cvScores(C.data, C.folds, C.k, C_HS, C.kern);
  C.cur = {
    mean: cv.mean,
    byFold: cv.byFold,
    train: scoreGrid(C.data, C.data, C_HS, C.kern),
    fresh: newDataScores(C.data, C.truth, C_HS, C.kern),
  };
  C.scott = scottH(C.data);
  let b = 0;
  cv.mean.forEach((v, i) => { if (v > cv.mean[b]) b = i; });
  C.best = C_HS[b];
  if (resetH || C.h === null) C.h = C.scott;
  cSetH(C.h);
  cSetFold = segmented(document.getElementById("c-folds"),
    [["-1", "all samples"], ...Array.from({ length: C.k },
      (_, j) => [String(j), `fold ${j + 1}`])],
    v => { C.fold = +v; cSetFold(v); cRender(); });
  cSetFold(String(C.fold));
  cRender();
}

const cSetTruth = segmented(document.getElementById("c-truths"),
  Object.entries(TRUTHS).map(([k, t]) => [k, t.label]),
  k => { C.truth = k; cSetTruth(k); cRecompute(true); });
const cSetKern = segmented(document.getElementById("c-kern"),
  KERNEL_ORDER.map(k => [k, KERNELS[k].label]),
  k => { C.kern = k; cSetKern(k); cRecompute(false); });
const cSetK = segmented(document.getElementById("c-k"),
  [["2", "2"], ["5", "5"], ["10", "10"]],
  v => { C.k = +v; cSetK(v); cRecompute(false); });
let cSetFold = () => {};
let cTimer = null;
const cSetN = sliderPair("c-nr", "c-n", 30, 1000, v => {
  C.n = Math.round(v);
  clearTimeout(cTimer);
  cTimer = setTimeout(() => cRecompute(false), 120);
}, true);
const cSetH = sliderPair("c-hr", "c-h", C_HS[0], C_HS[C_HS.length - 1],
  v => { C.h = v; cRender(); }, true);

document.getElementById("c-new").onclick = () => { C.seed++; cRecompute(false); };
document.getElementById("c-hs").onclick = () => {
  C.h = C.scott; cSetH(C.h); cRender();
};
document.getElementById("c-hb").onclick = () => {
  C.h = C.best; cSetH(C.h); cRender();
};
document.getElementById("c-truth").onchange = e => {
  C.truthOn = e.target.checked; cRender();
};
document.getElementById("c-new-on").onchange = e => {
  C.newOn = e.target.checked; cRender();
};

/** Scores at the chosen h: training, k-fold held-out, the shown fold. */
function cScoresAtH() {
  const h = [C.h];
  const cv = cvScores(C.data, C.folds, C.k, h, C.kern);
  return {
    train: scoreGrid(C.data, C.data, h, C.kern)[0],
    held: cv.mean[0],
    fold: C.fold >= 0 ? cv.byFold[C.fold][0] : NaN,
    fresh: newDataScores(C.data, C.truth, h, C.kern)[0],
  };
}

function cRender() {
  const T = TRUTHS[C.truth], xs = linspace(T.dom[0], T.dom[1], 600);
  const { train, test } = C.fold >= 0 ? splitFold(C.data, C.folds, C.fold) :
    { train: C.data, test: [] };
  const ph = kdePdf(train, C.h, C.kern, xs), pt = xs.map(T.pdf);
  const tmax = Math.max(...pt);
  const top = niceUp(1.08 * Math.min(Math.max(tmax, ...ph), 2.4 * tmax));
  const F = frame(C_TOP, T.dom, [0, top]);

  // Top: p̂ (from the training folds when a fold is held out) and samples.
  let s = axesSvg(F, { clip: "c-clip",
    ylabel: `<tspan class="sym">p̂</tspan>(<tspan class="sym">x</tspan>)`,
    xlabel: `<tspan class="sym">x</tspan>` });
  s += `<g clip-path="url(#c-clip)"><path class="kfill" d="${
    bandD(F, xs, new Float64Array(xs.length), ph)}"/><path class="kline" d="${
    pathD(F, xs, ph)}"/>`;
  if (C.truthOn) s += `<path class="truth" d="${pathD(F, xs, pt)}"/>`;
  if (test.length) {
    const at = kdePdf(train, C.h, C.kern, test);
    test.forEach((x, i) => {
      const X = F.sx(x).toFixed(1), Y = F.sy(at[i]).toFixed(1);
      s += `<line class="hstem" x1="${X}" x2="${X}" y1="${C_TOP.y1}"
        y2="${Y}"/><circle class="hdot${at[i] > 0 ? "" : " zero"}" cx="${X}"
        cy="${Y}" r="3.2"/>`;
    });
  }
  s += `</g>`;
  let d = "";
  for (const x of train) {
    if (x >= T.dom[0] && x <= T.dom[1]) d += `M${F.sx(x).toFixed(1)},${C_TOP.y1}v-10`;
  }
  s += `<path class="rug dark" d="${d}"/>`;
  for (const x of test) {
    if (x >= T.dom[0] && x <= T.dom[1]) {
      s += `<path class="rug held" d="M${F.sx(x).toFixed(1)},${C_TOP.y1}v-16"/>`;
    }
  }
  cTop.innerHTML = s;

  // Bottom: score against h.
  const cur = C.cur;
  const finite = [...cur.mean].filter(Number.isFinite);
  const bestS = Math.max(...finite);
  const yd = [bestS - 2.5, bestS + 1];
  const G = C_F = frame(C_CH, [C_HS[0], C_HS[C_HS.length - 1]], yd, true);
  let c = axesSvg(G, { clip: "c-clip2",
    xticks: logTicks(C_HS[0], C_HS[C_HS.length - 1]),
    xlabel: `bandwidth <tspan class="sym">h</tspan> (log scale)`,
    ylabel: `mean ln <tspan class="sym">p̂</tspan> (nats)` });
  c += `<g clip-path="url(#c-clip2)">`;
  c += `<path class="sc train" d="${pathD(G, C_HS, cur.train)}"/>`;
  if (C.newOn) c += `<path class="sc fresh" d="${pathD(G, C_HS, cur.fresh)}"/>`;
  if (C.fold >= 0) {
    c += `<path class="sc fold" d="${pathD(G, C_HS, cur.byFold[C.fold])}"/>`;
  }
  c += `<path class="sc held" d="${pathD(G, C_HS, cur.mean)}"/>`;
  const vline = (h, cls, label, anchor) => {
    const X = G.sx(h).toFixed(1);
    return `<line class="mk ${cls}" x1="${X}" x2="${X}" y1="${C_CH.y0}"
      y2="${C_CH.y1}"/><text class="mkl ${cls}" x="${+X + (anchor === "end" ?
      -5 : 5)}" y="${C_CH.y1 - 8}" text-anchor="${anchor}">${label}</text>`;
  };
  const sAnchor = C.scott > C.best ? "start" : "end";
  const bAnchor = C.scott > C.best ? "end" : "start";
  c += vline(C.scott, "scott", `Scott ${fmtH(C.scott)}`, sAnchor);
  c += vline(C.best, "best", `CV best ${fmtH(C.best)}`, bAnchor);
  c += `</g>`;
  // Where the training curve leaves the top of the chart.
  const exit = C_HS.findIndex((_, i) => cur.train[i] < yd[1]);
  if (exit > 0) {
    c += `<text class="mkl train" x="${(G.sx(C_HS[exit]) + 26).toFixed(1)}"
      y="${C_CH.y0 + 16}">training &rarr; &infin; as h &rarr; 0</text>`;
  }
  const S = cScoresAtH();
  const X = G.sx(C.h).toFixed(1);
  c += `<line class="hnow" x1="${X}" x2="${X}" y1="${C_CH.y0}" y2="${C_CH.y1}"/>`;
  if (Number.isFinite(S.held) && S.held > yd[0] && S.held < yd[1]) {
    c += `<circle class="hknob" cx="${X}" cy="${G.sy(S.held).toFixed(1)}" r="7"/>`;
  }
  c += `<rect class="pickzone" x="${C_CH.x0}" y="${C_CH.y0}" width="${
    C_CH.x1 - C_CH.x0}" height="${C_CH.y1 - C_CH.y0}"/>`;
  cChart.innerHTML = c;

  const fresh = Number.isFinite(S.fresh) || S.fresh === -Infinity ?
    fmt(S.fresh) : "";
  document.getElementById("c-read").innerHTML =
    row("bandwidth <i>h</i>", fmtH(C.h)) +
    row(`<span class="kk train"></span>training samples`, fmt(S.train)) +
    row(`<span class="kk held"></span>held-out, ${C.k}-fold mean`, fmt(S.held)) +
    (C.fold >= 0 ? row(`<span class="kk fold"></span>fold ${C.fold + 1}
      held out`, fmt(S.fold)) : "") +
    row(`<span class="kk fresh"></span>new data from the truth`, fresh);
  document.getElementById("c-marks").innerHTML =
    row(`<span class="kk scott"></span>Scott's rule
      &sigma;<i>n</i><sup>&minus;1/5</sup>`, fmtH(C.scott)) +
    row(`<span class="kk best"></span>CV best (highest held-out)`,
      fmtH(C.best));
  document.getElementById("c-foldnote").innerHTML = C.fold >= 0 ?
    `<p class="muted">Top: <i>p̂</i> built from the other ${C.k - 1} folds.
    Each held-out sample (orange) is scored by the height of <i>p̂</i> above
    it; a red dot sits where <i>p̂</i> = 0, so ln <i>p̂</i> = &minus;&infin;.</p>`
    : `<p class="muted">Top: <i>p̂</i> built from all ${C.n} samples. Pick a
    fold to see the held-out samples it is scored on.</p>`;
}

dragOn(cChart, {
  down(_, q) {
    if (q.x < C_CH.x0 - 6 || q.x > C_CH.x1 + 6) return false;
    this.move(q);
    return true;
  },
  move(q) {
    C.h = clamp(C_F.ix(q.x), C_HS[0], C_HS[C_HS.length - 1]);
    cSetH(C.h);
    cRender();
  },
});

function cvShow() {
  cSetTruth(C.truth);
  cSetKern(C.kern);
  cSetK(String(C.k));
  cSetN(C.n);
  document.getElementById("c-truth").checked = C.truthOn;
  document.getElementById("c-new-on").checked = C.newOn;
  if (!C.cur) cRecompute(true);
  else cRender();
}
