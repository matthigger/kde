// Bumps tab: a few samples on a line, a kernel bump on each, and p̂ their
// average. Samples drag, add (click empty space) and remove (double-click,
// or drag below the plot). Hover writes p̂(x) out as its sum; "Draw"
// samples from p̂ one sample's bump at a time.

const U_DOM = [-2, 8];
const U_BOX = { x0: 64, x1: 884, y0: 16, y1: 336 };
const U_RUG = 384, U_DRAWS = 424, U_DROP = 450, U_MAX = 40;
const U_XS = linspace(U_DOM[0], U_DOM[1], 801);

const U_PRESETS = {
  six: { label: "six points", x: [.5, 1.3, 1.7, 2.2, 4, 5.2] },
  clumps: { label: "two clumps", x: [.2, .6, .9, 1.2, 4.8, 5.1, 5.5] },
  loner: { label: "one loner", x: [1, 1.3, 1.8, 2.1, 2.4, 6.6] },
  even: { label: "evenly spaced", x: [0, 1, 2, 3, 4, 5, 6] },
  one: { label: "one point", x: [3] },
};

const U = {
  pts: [],
  nextC: 0,
  h: .6,
  kern: "gaussian",
  view: "over",
  preset: "six",
  hover: null,
  hl: -1,
  drag: null,
  removing: false,
  adding: null,
  lastAdd: { t: 0, x: NaN },
  draws: [],
  last: null,
  rng: mulberry32(Date.now() % 1e9),
};
let U_F = null;

const uSvg = document.getElementById("u-plot");

/** Replace the samples with a preset's. */
function uPreset(name) {
  U.preset = name;
  U.nextC = 0;
  U.pts = U_PRESETS[name].x.map(x => ({ x, c: U.nextC++ % 8 }));
  uChanged();
}

/** p̂ changed: earlier draws no longer come from it. */
function uChanged() {
  U.draws = [];
  U.last = null;
  uRender();
}

const uSetKern = segmented(document.getElementById("u-kern"),
  KERNEL_ORDER.map(k => [k, KERNELS[k].label]),
  k => { U.kern = k; uSetKern(k); uChanged(); });
const uSetView = segmented(document.getElementById("u-view"),
  [["over", "overlaid"], ["stack", "stacked"]],
  v => { U.view = v; uSetView(v); uRender(); });
const uSetPreset = segmented(document.getElementById("u-presets"),
  Object.entries(U_PRESETS).map(([k, p]) => [k, p.label]),
  k => { uSetPreset(k); uPreset(k); });
const uSetH = sliderPair("u-hr", "u-h", .05, 5,
  h => { U.h = h; uChanged(); }, true);

/** Value of each sample's bump K_h(x − xᵢ)/n at one x. */
function uTermsAt(x) {
  const K = KERNELS[U.kern].k, n = U.pts.length;
  return U.pts.map(p => K((x - p.x) / U.h) / (n * U.h));
}

function uRender() {
  const pts = U.pts, n = pts.length, data = pts.map(p => p.x);
  const { bumps, p } = n ? kdeBumps(data, U.h, U.kern, U_XS) :
    { bumps: [], p: new Float64Array(U_XS.length) };

  // Draws, histogrammed once there are enough to show a shape.
  const bw = .25, nb = Math.round((U_DOM[1] - U_DOM[0]) / bw);
  const counts = new Array(nb).fill(0);
  for (const x of U.draws) {
    const j = Math.floor((x - U_DOM[0]) / bw);
    if (j >= 0 && j < nb) counts[j]++;
  }
  const showHist = U.draws.length >= 10;
  const dens = counts.map(c => c / (U.draws.length * bw));

  let ymax = Math.max(...p, .05);
  if (showHist) ymax = Math.max(ymax, ...dens);
  const F = U_F = frame(U_BOX, U_DOM, [0, niceUp(ymax * 1.08)]);
  const zero = new Float64Array(U_XS.length);

  let s = axesSvg(F, { clip: "u-clip",
    xlabel: `<tspan class="sym">x</tspan>`,
    ylabel: `<tspan class="sym">p̂</tspan>(<tspan class="sym">x</tspan>)` });
  s += `<g clip-path="url(#u-clip)">`;
  if (showHist) {
    counts.forEach((c, j) => {
      if (!c) return;
      const x0 = F.sx(U_DOM[0] + j * bw), x1 = F.sx(U_DOM[0] + (j + 1) * bw);
      const y = F.sy(dens[j]);
      s += `<rect class="dbar" x="${x0.toFixed(1)}" y="${y.toFixed(1)}"
        width="${(x1 - x0).toFixed(1)}" height="${(F.box.y1 - y).toFixed(1)}"/>`;
    });
  }
  if (U.view === "over") {
    bumps.forEach((b, i) => {
      const on = i === U.hl ? " on" : "";
      s += `<path class="bfill k${pts[i].c}${on}" d="${bandD(F, U_XS, zero, b)}"/>
        <path class="bline k${pts[i].c}${on}" d="${pathD(F, U_XS, b)}"/>`;
    });
  } else {
    let cum = zero;
    bumps.forEach((b, i) => {
      const up = cum.map((v, j) => v + b[j]);
      const on = i === U.hl ? " on" : "";
      s += `<path class="band k${pts[i].c}${on}" d="${bandD(F, U_XS, cum, up)}"/>`;
      cum = up;
    });
  }
  if (n) s += `<path class="phat" d="${pathD(F, U_XS, p)}"/>`;

  // Hover guide: each term at x, and their sum.
  if (U.hover !== null && n) {
    const X = F.sx(U.hover), t = uTermsAt(U.hover);
    const tot = t.reduce((a, b) => a + b, 0);
    s += `<line class="guide" x1="${X}" x2="${X}" y1="${F.box.y0}"
      y2="${F.box.y1}"/>`;
    let cum = 0;
    t.forEach((v, i) => {
      if (U.view === "stack") cum += v;
      const y = U.view === "stack" ? cum : v;
      if (v > 0) {
        s += `<circle class="tdot k${pts[i].c}" cx="${X}" cy="${F.sy(y)
          .toFixed(1)}" r="4.5"/>`;
      }
    });
    s += `<circle class="pdot" cx="${X}" cy="${F.sy(tot).toFixed(1)}" r="6"/>`;
  }
  s += `</g>`;

  if (!n) {
    s += `<text class="empty" x="${(U_BOX.x0 + U_BOX.x1) / 2}" y="${
      (U_BOX.y0 + U_BOX.y1) / 2}" text-anchor="middle">Click anywhere to
      add a sample</text>`;
  }

  // Samples: a tick at the axis and a draggable dot below it.
  s += `<line class="rugline" x1="${U_BOX.x0}" x2="${U_BOX.x1}"
    y1="${U_RUG}" y2="${U_RUG}"/>`;
  pts.forEach((pt, i) => {
    const X = F.sx(pt.x).toFixed(1);
    const gone = i === U.drag && U.removing;
    s += `<line class="stem k${pt.c}" x1="${X}" x2="${X}" y1="${U_BOX.y1 - 8}"
      y2="${U_RUG}"/><circle class="pt k${pt.c}${gone ? " gone" : ""}${
      i === U.hl ? " on" : ""}" cx="${X}" cy="${U_RUG}" r="10"
      data-h="p${i}"/>`;
    if (n <= 12) {
      s += `<text class="plabel" x="${X}" y="${U_RUG + 4.5}"
        text-anchor="middle">${i + 1}</text>`;
    }
  });
  if (U.drag !== null) {
    s += `<text class="droptxt${U.removing ? " on" : ""}" x="${
      (U_BOX.x0 + U_BOX.x1) / 2}" y="${U_DROP + 22}" text-anchor="middle">${
      U.removing ? "release to remove this sample" :
      "drag down here to remove"}</text>`;
  }

  // Draws from p̂, with the latest linked to the sample it came from.
  if (U.draws.length) {
    s += `<text class="rowlabel" x="${U_BOX.x0 - 8}" y="${U_DRAWS + 4}"
      text-anchor="end">draws</text>`;
  }
  for (const x of U.draws) {
    const X = F.sx(x);
    if (X < U_BOX.x0 || X > U_BOX.x1) continue;
    s += `<path class="draw" d="M${X.toFixed(1)},${U_DRAWS - 5}l5,5l-5,5l-5,-5z"/>`;
  }
  if (U.last && U.hl === U.last.i && pts[U.last.i]) {
    const a = F.sx(pts[U.last.i].x), b = F.sx(U.last.x);
    s += `<path class="dlink" d="M${a.toFixed(1)},${U_RUG + 10} L${
      b.toFixed(1)},${U_DRAWS - 6}"/><path class="draw last" d="M${
      b.toFixed(1)},${U_DRAWS - 6}l6,6l-6,6l-6,-6z"/>`;
  }
  uSvg.innerHTML = s;
  uReadouts(data);
}

/** Readouts: p̂(x) as a sum at the pointer, totals, the last draw. */
function uReadouts(data) {
  const n = data.length, h = U.h, K = KERNELS[U.kern].k;
  const at = document.getElementById("u-at");
  if (!n) {
    at.innerHTML = `<p class="muted">No samples yet.</p>`;
  } else if (U.hover === null) {
    at.innerHTML = `<p class="muted">Hover over the plot to write
      <i>p̂</i>(<i>x</i>) out as its sum.</p>`;
  } else {
    const x = U.hover, t = uTermsAt(x), tot = t.reduce((a, b) => a + b, 0);
    let rows = "";
    let hidden = 0;
    U.pts.forEach((pt, i) => {
      if (n > 10 && t[i] < 5e-4) { hidden++; return; }
      rows += `<tr${i === U.hl ? ` class="on"` : ""}><td><i class="chip
        k${pt.c}"></i><i>x</i>${sub(i + 1)} = ${fmt(pt.x)}</td><td>${
        fmt((x - pt.x) / h)}</td><td>${t[i].toFixed(3)}</td></tr>`;
    });
    if (hidden) {
      rows += `<tr><td colspan="2" class="muted">${hidden} more, each
        under 0.0005</td><td></td></tr>`;
    }
    at.innerHTML = `<table class="terms"><thead><tr><th>sample</th>
      <th><i>u</i> = (<i>x</i> &minus; <i>x</i><sub><i>i</i></sub>)/<i>h</i></th>
      <th><i>K</i>(<i>u</i>) / (<i>n h</i>)</th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><td colspan="2"><i>p̂</i>(${fmt(x)})
      = sum</td><td>${tot.toFixed(3)}</td></tr></tfoot></table>`;
  }

  let sum = "";
  if (n) {
    const kd = KERNELS[U.kern], reach = kd.compact ? 1.01 : 40;
    const lo = Math.min(...data) - reach * h, hi = Math.max(...data) + reach * h;
    const xs = linspace(lo, hi, Math.round(clamp((hi - lo) / h * 400,
      6001, 60001)));
    const area = trapz(xs, kdePdf(data, h, U.kern, xs));
    sum = row("samples <i>n</i>", n) +
      row("each bump's area, 1/<i>n</i>", fmt(1 / n, 3)) +
      row("each bump's peak, <i>K</i>(0)/(<i>n h</i>)", fmt(K(0) / (n * h), 3)) +
      row("area under <i>p̂</i>", fmt(area, 3));
  }
  document.getElementById("u-sum").innerHTML = sum;

  const L = U.last, el = document.getElementById("u-last");
  if (!U.draws.length) {
    el.innerHTML = `<p class="muted">Draws reset whenever <i>p̂</i>
      changes.</p>`;
  } else {
    el.innerHTML = (L && U.pts[L.i] ? row("last draw", `<i>x</i>${
      sub(L.i + 1)} + <i>h u</i> = ${fmt(U.pts[L.i].x)} ${
      L.u < 0 ? "&minus;" : "+"} ${fmt(h, 2)} &times; ${fmt(Math.abs(L.u))}
      = ${fmt(L.x)}`) : "") + row("draws so far", U.draws.length);
  }
}

/* ------------------------------------------------------------ pointer */

dragOn(uSvg, {
  down(hd, q) {
    if (hd && hd[0] === "p") {
      U.drag = +hd.slice(1);
      U.moved = false;
      U.hl = U.drag;
      return true;
    }
    if (q.x >= U_BOX.x0 && q.x <= U_BOX.x1) {
      U.adding = q;
      return true;
    }
    return false;
  },
  move(q) {
    if (U.drag === null) return;
    const pt = U.pts[U.drag];
    U.moved = true;
    pt.x = clamp(U_F.ix(q.x), U_DOM[0], U_DOM[1]);
    U.removing = q.y > U_DROP;
    U.hover = pt.x;
    uChanged();
  },
  up(q) {
    if (U.drag !== null) {
      if (U.removing) uRemove(U.drag);
      U.drag = null;
      U.removing = false;
      U.hl = -1;
      if (U.moved) uChanged();
      else uRender();
      return;
    }
    const a = U.adding;
    U.adding = null;
    if (!a || Math.hypot(q.x - a.x, q.y - a.y) > 5) return;
    const x = clamp(U_F.ix(q.x), U_DOM[0], U_DOM[1]), now = Date.now();
    // The second click of a double-click would add a twin.
    if (now - U.lastAdd.t < 450 && Math.abs(x - U.lastAdd.x) < .05) return;
    if (U.pts.length >= U_MAX) return;
    U.lastAdd = { t: now, x };
    U.pts.push({ x, c: U.nextC++ % 8 });
    uSetPreset(null);
    uChanged();
  },
});

function uRemove(i) {
  U.pts.splice(i, 1);
  uSetPreset(null);
}

uSvg.addEventListener("dblclick", e => {
  const t = e.target.closest("[data-h]");
  if (!t) return;
  uRemove(+t.dataset.h.slice(1));
  U.hl = -1;
  uChanged();
});

uSvg.addEventListener("pointermove", e => {
  if (U.drag !== null || !U_F) return;
  const q = svgPoint(uSvg, e);
  const t = e.target.closest("[data-h]");
  const hl = t ? +t.dataset.h.slice(1) : (U.last && U.hl === U.last.i ?
    U.hl : -1);
  const inside = q.x >= U_BOX.x0 && q.x <= U_BOX.x1 && q.y <= U_DROP;
  const hover = t ? U.pts[hl].x : inside ? U_F.ix(q.x) : null;
  if (hover === U.hover && hl === U.hl) return;
  U.hover = hover;
  U.hl = hl;
  uRender();
});
uSvg.addEventListener("pointerleave", () => {
  if (U.drag !== null) return;
  U.hover = null;
  if (!(U.last && U.hl === U.last.i)) U.hl = -1;
  uRender();
});

/* -------------------------------------------------------------- draws */

let uHlTimer = null;
document.getElementById("u-draw1").onclick = () => {
  if (!U.pts.length) return;
  const d = kdeDraw(U.pts.map(p => p.x), U.h, U.kern, U.rng);
  U.draws.push(d.x);
  U.last = d;
  U.hl = d.i;
  uRender();
  clearTimeout(uHlTimer);
  uHlTimer = setTimeout(() => {
    if (U.hl === d.i && U.drag === null) { U.hl = -1; uRender(); }
  }, 1600);
};
document.getElementById("u-draw100").onclick = () => {
  if (!U.pts.length) return;
  const data = U.pts.map(p => p.x);
  for (let r = 0; r < 100; r++) U.draws.push(kdeDraw(data, U.h, U.kern, U.rng).x);
  U.last = null;
  U.hl = -1;
  uRender();
};
document.getElementById("u-clear").onclick = () => uChanged();

function bumpsShow() {
  if (!U.pts.length && U.preset) uPreset(U.preset);
  uSetKern(U.kern);
  uSetView(U.view);
  uSetPreset(U.preset);
  uSetH(U.h);
  uRender();
}
