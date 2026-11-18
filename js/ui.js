// Shared helpers: 1-d plot frames (scales, ticks, axes, paths), pointer
// dragging, number formatting, controls (segmented, linear and log
// sliders) and the footer build stamp.

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** Number with a true minus sign. */
function fmt(x, digits = 2) {
  if (x === -Infinity) return "−∞";
  if (x === Infinity) return "∞";
  const a = Math.abs(x).toFixed(digits);
  return (x < 0 && a !== (0).toFixed(digits) ? "−" : "") + a;
}

/** Number with a sign always shown (+ or −). */
function fmtS(x, digits = 2) {
  const s = fmt(x, digits);
  return s.startsWith("−") ? s : "+" + s;
}

/** Bandwidth-style number: 3 significant digits, no exponent. */
function fmtH(h) {
  return h >= 10 ? h.toFixed(1) : h >= 1 ? h.toFixed(2) :
    h >= .1 ? h.toFixed(3) : h.toFixed(4);
}

/** Readout row: label on the left, value on the right. */
function row(label, val, cls = "") {
  return `<div class="row ${cls}"><span>${label}</span><span class="val">${
    val}</span></div>`;
}

/**
 * Single-choice segmented control.
 *
 * Args:
 *   el (Element): container
 *   items ([string, string][]): [value, label] pairs
 *   onPick (Function): (value) on click
 *
 * Returns:
 *   (Function): (value) -> mark that button as chosen
 */
function segmented(el, items, onPick) {
  el.innerHTML = items.map(([v, label]) =>
    `<button role="radio" data-v="${v}">${label}</button>`).join("");
  for (const b of el.querySelectorAll("button")) {
    b.onclick = () => onPick(b.dataset.v);
  }
  return v => {
    for (const b of el.querySelectorAll("button")) {
      b.setAttribute("aria-checked", b.dataset.v === String(v));
    }
  };
}

/** Input text for v: at most 3 significant decimals, no trailing zeros. */
const inTxt = v => String(Number(v.toPrecision(3)));

/** Set an input's value unless the student is typing in it. */
function setIn(el, v) {
  if (document.activeElement !== el) el.value = v;
}

/**
 * Pair a range slider with a number input.
 *
 * Args:
 *   rangeId, numId (string): element ids
 *   lo, hi (number): allowed values
 *   onSet (Function): (v) on either input
 *   log (bool): the slider moves in ln v (the number box stays linear)
 *
 * Returns:
 *   (Function): (v) -> show v in both
 */
function sliderPair(rangeId, numId, lo, hi, onSet, log = false) {
  const r = document.getElementById(rangeId);
  const n = document.getElementById(numId);
  const toR = v => log ? 1000 * Math.log(v / lo) / Math.log(hi / lo) : v;
  const fromR = t => log ? lo * (hi / lo) ** (t / 1000) : t;
  if (log) { r.min = 0; r.max = 1000; r.step = 1; }
  r.addEventListener("input", () => {
    const v = fromR(parseFloat(r.value));
    n.value = inTxt(v);
    onSet(clamp(v, lo, hi));
  });
  n.addEventListener("input", () => {
    const v = parseFloat(n.value);
    if (!Number.isFinite(v) || v < lo || v > hi) return;
    r.value = toR(v);
    onSet(v);
  });
  n.addEventListener("change", () => n.blur());
  return v => { setIn(r, toR(v)); setIn(n, inTxt(v)); };
}

/* ---------------------------------------------------------- plotting */

/**
 * Scales of a plot box.
 *
 * Args:
 *   box ({x0, x1, y0, y1}): plot area in viewBox units (y0 on top)
 *   xd, yd ([number, number]): data ranges
 *   xlog (bool): log x axis
 *
 * Returns:
 *   {box, xd, yd, xlog, sx, sy, ix}: data to viewBox (sx, sy), viewBox x
 *     to data (ix)
 */
function frame(box, xd, yd, xlog = false) {
  const f = xlog ? Math.log : v => v;
  const a = f(xd[0]), b = f(xd[1]), W = box.x1 - box.x0;
  return {
    box, xd, yd, xlog,
    sx: v => box.x0 + (f(v) - a) / (b - a) * W,
    sy: v => box.y1 - (v - yd[0]) / (yd[1] - yd[0]) * (box.y1 - box.y0),
    ix: p => {
      const t = a + (p - box.x0) / W * (b - a);
      return xlog ? Math.exp(t) : t;
    },
  };
}

/** Step of about (hi − lo) / target, rounded to 1, 2 or 5 × 10^k. */
function niceStep(lo, hi, target) {
  const raw = (hi - lo) / target, e = 10 ** Math.floor(Math.log10(raw));
  const m = raw / e;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e;
}

/** Tick values from lo to hi at a nice step. */
function niceTicks(lo, hi, target = 6) {
  const s = niceStep(lo, hi, target), out = [];
  for (let v = Math.ceil(lo / s - 1e-9) * s; v <= hi + 1e-9 * s; v += s) {
    out.push(Math.abs(v) < s * 1e-9 ? 0 : v);
  }
  return out;
}

/** Smallest nice number (1, 2, 2.5, 5 × 10^k) at least v. */
function niceUp(v) {
  const e = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (m * e >= v * (1 - 1e-9)) return m * e;
  }
  return 10 * e;
}

/** Digits needed to print the ticks at step s. */
const tickDigits = s => Math.max(0, -Math.floor(Math.log10(s) + 1e-9));

/**
 * Clip path, grid lines, ticks and axis labels for frame F.
 *
 * Args:
 *   o.clip (string): clip-path id to define over the box
 *   o.xlabel, o.ylabel (string): SVG markup for the labels
 *   o.yticks (bool): draw y ticks and labels (default true)
 *   o.xticks (number[] | undefined): x tick values; default nice ticks
 */
function axesSvg(F, o) {
  const b = F.box;
  let a = `<defs><clipPath id="${o.clip}"><rect x="${b.x0}" y="${b.y0 - 2}"
    width="${b.x1 - b.x0}" height="${b.y1 - b.y0 + 2}"/></clipPath></defs>`;
  const xt = o.xticks || niceTicks(F.xd[0], F.xd[1], 10);
  const xs = xt.length > 1 ? Math.abs(xt[1] - xt[0]) : 1;
  for (const v of xt) {
    const X = F.sx(v).toFixed(1);
    a += `<line class="grid${v === 0 && !F.xlog ? " zero" : ""}" x1="${X}"
      x2="${X}" y1="${b.y0}" y2="${b.y1}"/><text class="tick" x="${X}"
      y="${b.y1 + 17}" text-anchor="middle">${
      F.xlog ? String(v) : fmt(v, tickDigits(xs))}</text>`;
  }
  if (o.yticks !== false) {
    const yt = niceTicks(F.yd[0], F.yd[1], 5);
    const ys = yt.length > 1 ? yt[1] - yt[0] : 1;
    for (const v of yt) {
      const Y = F.sy(v).toFixed(1);
      a += `<line class="grid" x1="${b.x0}" x2="${b.x1}" y1="${Y}"
        y2="${Y}"/><text class="tick" x="${b.x0 - 7}" y="${+Y + 4}"
        text-anchor="end">${fmt(v, tickDigits(ys))}</text>`;
    }
  }
  a += `<line class="axis" x1="${b.x0}" x2="${b.x1}" y1="${b.y1}"
    y2="${b.y1}"/>`;
  if (o.xlabel) {
    a += `<text class="axis-label" x="${b.x1}" y="${b.y1 + 36}"
      text-anchor="end">${o.xlabel}</text>`;
  }
  if (o.ylabel) {
    a += `<text class="axis-label" text-anchor="middle"
      transform="translate(${b.x0 - 44} ${(b.y0 + b.y1) / 2}) rotate(-90)"
      >${o.ylabel}</text>`;
  }
  return a;
}

/** Log-axis tick values (1, 2, 5 × 10^k) inside [lo, hi]. */
function logTicks(lo, hi) {
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of [1, 2, 5]) {
      const v = Number((m * 10 ** e).toPrecision(2));
      if (v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)) out.push(v);
    }
  }
  return out;
}

/**
 * SVG path "d" through (xs, ys) in frame F.
 *
 * Breaks at non-finite y; clamps far-off values so the path stays drawable
 * (the box's clip path hides the overshoot).
 */
function pathD(F, xs, ys) {
  let d = "", pen = false;
  const lo = F.box.y0 - 60, hi = F.box.y1 + 60;
  for (let j = 0; j < xs.length; j++) {
    if (!Number.isFinite(ys[j])) { pen = false; continue; }
    const Y = clamp(F.sy(ys[j]), lo, hi);
    d += `${pen ? "L" : "M"}${F.sx(xs[j]).toFixed(1)},${Y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** SVG path "d" of the area between lower and upper over xs. */
function bandD(F, xs, lower, upper) {
  const lo = F.box.y0 - 60, hi = F.box.y1 + 60;
  const pt = (x, y) => `${F.sx(x).toFixed(1)},${clamp(F.sy(y), lo, hi)
    .toFixed(1)}`;
  let d = `M${pt(xs[0], lower[0])}`;
  for (let j = 0; j < xs.length; j++) d += `L${pt(xs[j], upper[j])}`;
  for (let j = xs.length - 1; j >= 0; j--) d += `L${pt(xs[j], lower[j])}`;
  return d + "Z";
}

/** Pointer position in the viewBox units of an SVG. */
function svgPoint(el, e) {
  const pt = el.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  return pt.matrixTransform(el.getScreenCTM().inverse());
}

/**
 * Route pointer drags on svg to handlers.
 *
 * Args:
 *   h.down (Function): (handle, q, e) -> bool, handle = data-h of the
 *     element under the pointer (or null), q the pointer in viewBox
 *     units; return true to start a drag
 *   h.move (Function): (q, e) during the drag
 *   h.up (Function | undefined): (q, e) at the end
 */
function dragOn(svg, h) {
  svg.addEventListener("pointerdown", e => {
    if (e.button) return;
    const t = e.target.closest("[data-h]");
    if (!h.down(t ? t.dataset.h : null, svgPoint(svg, e), e)) return;
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    const move = ev => h.move(svgPoint(svg, ev), ev);
    const up = ev => {
      svg.removeEventListener("pointermove", move);
      svg.removeEventListener("pointerup", up);
      svg.removeEventListener("pointercancel", up);
      if (h.up) h.up(svgPoint(svg, ev), ev);
    };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
  });
}

/** Subscript digits for i (x₁₂). */
function sub(i) {
  return String(i).replace(/\d/g, c => "₀₁₂₃₄₅₆₇₈₉"[c]);
}

// Footer build stamp: the deployed commit (linked) and build time.
(function () {
  const el = document.getElementById("build");
  if (!el) return;
  const repo = "https://github.com/matthigger/kde";
  if (!BUILD) { el.textContent = "local copy"; return; }
  const when = new Date(BUILD.time).toLocaleString("en-US", {
    dateStyle: "medium", timeStyle: "short" });
  el.innerHTML = `build <a href="${repo}/commit/${BUILD.sha}">${
    BUILD.sha.slice(0, 7)}</a>, ${when}`;
})();
