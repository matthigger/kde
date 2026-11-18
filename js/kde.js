// The math: kernels, the KDE p̂, draws from kernels and from p̂, the hidden
// true pdfs of the bins and choosing-h tabs, Scott's rule and k-fold
// cross-validated log-likelihood. No DOM here.
//
// p̂(x) = (1/n) Σᵢ K_h(x − xᵢ), K_h(u) = K(u/h) / h (Rosenblatt 1956;
// Parzen 1962). Kernels match sklearn's KernelDensity, each a pdf with
// bandwidth 1; the compact ones are zero for |u| >= 1.

const SQ2PI = Math.sqrt(2 * Math.PI);

/**
 * Kernels by sklearn name.
 *
 * Each entry: label (string), compact (bool, zero outside |u| < 1),
 * k (u -> K(u)), draw (rng -> one draw from K), var (variance of K).
 */
const KERNELS = {
  gaussian: {
    label: "Gaussian", compact: false, var: 1,
    k: u => Math.exp(-.5 * u * u) / SQ2PI,
    draw: rng => normal(rng),
  },
  tophat: {
    label: "tophat", compact: true, var: 1 / 3,
    k: u => Math.abs(u) < 1 ? .5 : 0,
    draw: rng => 2 * rng() - 1,
  },
  epanechnikov: {
    label: "Epanechnikov", compact: true, var: 1 / 5,
    k: u => Math.abs(u) < 1 ? .75 * (1 - u * u) : 0,
    // Of three U(−1, 1) draws, the middle-or-smaller pick has this
    // density (Devroye 1986).
    draw: rng => {
      const a = 2 * rng() - 1, b = 2 * rng() - 1, c = 2 * rng() - 1;
      const big = Math.abs(c) >= Math.abs(b) && Math.abs(c) >= Math.abs(a);
      return big ? b : c;
    },
  },
  linear: {
    label: "linear", compact: true, var: 1 / 6,
    k: u => Math.abs(u) < 1 ? 1 - Math.abs(u) : 0,
    draw: rng => rng() + rng() - 1,
  },
  cosine: {
    label: "cosine", compact: true, var: 1 - 8 / (Math.PI * Math.PI),
    k: u => Math.abs(u) < 1 ? Math.PI / 4 * Math.cos(Math.PI * u / 2) : 0,
    draw: rng => 2 / Math.PI * Math.asin(2 * rng() - 1),
  },
  exponential: {
    label: "exponential", compact: false, var: 2,
    k: u => .5 * Math.exp(-Math.abs(u)),
    draw: rng => (rng() < .5 ? -1 : 1) * -Math.log(1 - rng()),
  },
};
const KERNEL_ORDER = ["gaussian", "tophat", "epanechnikov", "linear",
  "cosine", "exponential"];

/** Seeded uniform [0, 1) generator (mulberry32). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One standard normal draw (Box-Muller). */
function normal(rng) {
  const u = 1 - rng(), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** N(mu, sd²) pdf at x. */
function npdf(x, mu, sd) {
  const z = (x - mu) / sd;
  return Math.exp(-.5 * z * z) / (sd * SQ2PI);
}

/**
 * Evaluate p̂ on xs, one array per sample.
 *
 * Args:
 *   data (number[]): (n,) samples
 *   h (number): bandwidth
 *   kern (string): KERNELS key
 *   xs (number[]): (m,) where to evaluate
 *
 * Returns:
 *   bumps (Float64Array[]): (n, m) K_h(x − xᵢ) / n, each sample's share
 *   p (Float64Array): (m,) p̂, the sum of the bumps
 */
function kdeBumps(data, h, kern, xs) {
  const K = KERNELS[kern].k, n = data.length, m = xs.length;
  const p = new Float64Array(m);
  const bumps = data.map(xi => {
    const b = new Float64Array(m);
    for (let j = 0; j < m; j++) {
      b[j] = K((xs[j] - xi) / h) / (n * h);
      p[j] += b[j];
    }
    return b;
  });
  return { bumps, p };
}

/** p̂ on xs: (m,) Float64Array (see kdeBumps). */
function kdePdf(data, h, kern, xs) {
  const K = KERNELS[kern].k, n = data.length, out = new Float64Array(xs.length);
  for (let j = 0; j < xs.length; j++) {
    let s = 0;
    for (const xi of data) s += K((xs[j] - xi) / h);
    out[j] = s / (n * h);
  }
  return out;
}

/** One draw from p̂: a random sample plus h times a draw from K. */
function kdeDraw(data, h, kern, rng) {
  const i = Math.floor(rng() * data.length);
  const u = KERNELS[kern].draw(rng);
  return { i, u, x: data[i] + h * u };
}

/** Trapezoid area under ys on the evenly spaced grid xs. */
function trapz(xs, ys) {
  let s = 0;
  for (let j = 1; j < xs.length; j++) {
    s += (ys[j] + ys[j - 1]) * (xs[j] - xs[j - 1]) / 2;
  }
  return s;
}

/** m evenly spaced numbers from a to b. */
function linspace(a, b, m) {
  return Array.from({ length: m }, (_, j) => a + (b - a) * j / (m - 1));
}

/** m log-spaced numbers from a to b. */
function geomspace(a, b, m) {
  return linspace(Math.log(a), Math.log(b), m).map(Math.exp);
}

/**
 * Hidden true pdfs for the bins and choosing-h tabs.
 *
 * Each entry: label (string), dom ([lo, hi] plotted range), pdf (x ->
 * p(x)), draw (rng -> one draw), grid ([lo, hi] holding all its mass, for
 * integrals).
 */
const TRUTHS = {
  humps: {
    label: "two humps", dom: [-4, 9], grid: [-7, 12],
    pdf: x => .5 * npdf(x, 0, 1) + .5 * npdf(x, 5, 1),
    draw: rng => normal(rng) + (rng() < .5 ? 5 : 0),
  },
  wavy: {
    label: "wavy", dom: [-4, 4], grid: [-7, 7],
    pdf: x => npdf(x, 0, 1) * (1 + .7 * Math.sin(6 * x)),
    // Rejection sampling from N(0, 1): p / N(0, 1) <= 1.7.
    draw: rng => {
      for (;;) {
        const x = normal(rng);
        if (rng() * 1.7 < 1 + .7 * Math.sin(6 * x)) return x;
      }
    },
  },
  skewed: {
    label: "skewed", dom: [-1, 9], grid: [-1, 30],
    pdf: x => x > 0 ? x * Math.exp(-x) : 0,
    draw: rng => -Math.log(1 - rng()) - Math.log(1 - rng()),
  },
  bell: {
    label: "one bell", dom: [-4, 4], grid: [-7, 7],
    pdf: x => npdf(x, 0, 1),
    draw: rng => normal(rng),
  },
  flat: {
    label: "flat, hard edges", dom: [-4, 4], grid: [-4, 4],
    pdf: x => Math.abs(x) <= 2 ? .25 : 0,
    draw: rng => 4 * rng() - 2,
  },
  peak: {
    label: "sharp peak, wide base", dom: [-6, 6], grid: [-12, 12],
    pdf: x => .3 * npdf(x, 0, .15) + .7 * npdf(x, 0, 2),
    draw: rng => rng() < .3 ? .15 * normal(rng) : 2 * normal(rng),
  },
};

/** n draws from TRUTHS[name], reproducible from seed. */
function drawTruth(name, n, seed) {
  const rng = mulberry32(seed * 7919 + name.length * 104729);
  return Array.from({ length: n }, () => TRUTHS[name].draw(rng));
}

/** Sample standard deviation (n − 1). */
function sampleSd(x) {
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1));
}

/** Scott's rule h = σ n^(−1/5) (Scott 1992), for Gaussian-shaped data. */
function scottH(x) {
  return sampleSd(x) * x.length ** -.2;
}

/**
 * Weighted mean of ln p̂(t) over test points t, for each h on a grid.
 *
 * Sums run in log space for the unbounded kernels (offset by the nearest
 * sample) so a tiny h gives a large negative score, not ln 0. A compact
 * kernel with no sample within h of t really is ln 0 = −∞.
 *
 * Args:
 *   train (number[]): (n,) samples p̂ is built from
 *   test (number[]): (m,) points to score
 *   hs (number[]): (num_h,) bandwidths
 *   kern (string): KERNELS key
 *   wts (number[] | undefined): (m,) weights summing to 1; default 1/m.
 *     Points with weight 0 are skipped.
 *
 * Returns:
 *   (Float64Array): (num_h,) Σ_t w_t ln p̂(t), in nats (may be −∞)
 */
function scoreGrid(train, test, hs, kern, wts) {
  const n = train.length, m = test.length;
  const out = new Float64Array(hs.length);
  const kd = KERNELS[kern];
  const d = new Float64Array(n);
  for (let t = 0; t < m; t++) {
    const w = wts ? wts[t] : 1 / m;
    if (!(w > 0)) continue;
    let dmin = Infinity;
    for (let i = 0; i < n; i++) {
      d[i] = Math.abs(test[t] - train[i]);
      if (d[i] < dmin) dmin = d[i];
    }
    for (let j = 0; j < hs.length; j++) {
      const h = hs[j];
      let s = 0, ln;
      if (kern === "gaussian") {
        const c = 1 / (2 * h * h), d2 = dmin * dmin;
        for (let i = 0; i < n; i++) s += Math.exp(-(d[i] * d[i] - d2) * c);
        ln = -d2 * c + Math.log(s / (n * h * SQ2PI));
      } else if (kern === "exponential") {
        for (let i = 0; i < n; i++) s += Math.exp(-(d[i] - dmin) / h);
        ln = -dmin / h + Math.log(s / (2 * n * h));
      } else {
        for (let i = 0; i < n; i++) if (d[i] < h) s += kd.k(d[i] / h);
        ln = Math.log(s / (n * h));
      }
      out[j] += w * ln;
    }
  }
  return out;
}

/**
 * Fold of each sample for k-fold cross-validation, reproducible from seed.
 *
 * Returns:
 *   (Int32Array): (n,) fold index in 0..k-1; fold sizes differ by <= 1
 */
function foldIds(n, k, seed) {
  const rng = mulberry32(seed * 31 + k);
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const f = new Int32Array(n);
  idx.forEach((i, r) => { f[i] = r % k; });
  return f;
}

/** Split x by fold: the samples outside fold j, and those in it. */
function splitFold(x, folds, j) {
  const train = [], test = [];
  x.forEach((v, i) => (folds[i] === j ? test : train).push(v));
  return { train, test };
}

/**
 * Cross-validated held-out score on a grid of h (the deck's recipe).
 *
 * Args:
 *   x (number[]): (n,) samples
 *   folds (Int32Array): (n,) fold of each sample (see foldIds)
 *   k (number): number of folds
 *   hs (number[]): (num_h,) bandwidths
 *   kern (string): KERNELS key
 *
 * Returns:
 *   mean (Float64Array): (num_h,) mean over folds of mean held-out ln p̂
 *   byFold (Float64Array[]): (k, num_h) each fold's mean held-out ln p̂,
 *     p̂ fit on the other k − 1 folds
 */
function cvScores(x, folds, k, hs, kern) {
  const byFold = [];
  const mean = new Float64Array(hs.length);
  for (let j = 0; j < k; j++) {
    const { train, test } = splitFold(x, folds, j);
    const s = scoreGrid(train, test, hs, kern);
    byFold.push(s);
    for (let i = 0; i < hs.length; i++) mean[i] += s[i] / k;
  }
  return { mean, byFold };
}

/**
 * Expected ln p̂ on new data from the truth, ∫ p(x) ln p̂(x) dx.
 *
 * Quadrature on m points over the truth's grid range.
 *
 * Returns:
 *   (Float64Array): (num_h,) in nats
 */
function newDataScores(x, truth, hs, kern, m = 301) {
  const T = TRUTHS[truth];
  const xs = linspace(T.grid[0], T.grid[1], m);
  const p = xs.map(T.pdf);
  const tot = p.reduce((a, b) => a + b, 0);
  return scoreGrid(x, xs, hs, kern, p.map(v => v / tot));
}
