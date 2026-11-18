# kde

Interactive teaching demo of kernel density estimation, a companion to the
other "visually" demos (e.g. [LDA](https://github.com/matthigger/lda),
[clustering](https://github.com/matthigger/clustering)). Live at
<https://matthigger.github.io/kde/>. Notation: samples x₁, ..., xₙ,
kernel K (any pdf centered at 0), bandwidth h,
K_h(u) = K(u/h)/h and p̂(x) = (1/n) Σᵢ K_h(x − xᵢ); scores are mean ln p̂
in nats. Kernels are sklearn's six (Gaussian, tophat, Epanechnikov,
linear, cosine, exponential). Three tabs:

- **A few samples** (`#bumps`). Six samples on a line (or a preset),
  a bump K_h(x − xᵢ)/n on each, overlaid or stacked, and p̂ their sum.
  Drag a sample, click empty space to add one, double-click or drag it
  below the plot to remove it. Hovering writes p̂(x) out term by term;
  the totals show each bump's area 1/n, its peak K(0)/(nh) and the area
  under p̂. *Draw* samples from p̂ (pick an xᵢ, add h times a draw from
  K), one at a time with the source sample highlighted, or 100 at once,
  histogrammed under p̂.
- **Bins vs. bumps** (`#bins`). n samples from a hidden true pdf (two
  humps, wavy, skewed, one bell, flat with hard edges, sharp peak on a
  wide base). A histogram (bin count, shift) above a KDE (kernel, h) on
  one y scale, each with its distance from the truth ½∫|p̂ − p|.
  *tophat, h = w/2* turns the KDE into a histogram with a sliding bin.
- **Choosing h** (`#choosing-h`). For a grid of h: the training score
  (→ ∞ as h → 0), the k-fold held-out score, and the score on new data
  from the truth, ∫ p ln p̂. Scott's rule σn^(−1/5) and the CV best are
  marked; drag on the chart to set h. Pick a fold to see p̂ from the other
  folds and the held-out samples it is scored on (p̂ = 0, ln p̂ = −∞, in
  red).

Plain HTML/CSS/JS with SVG: no build step and no dependencies, so it also
works offline from `file://`. The math is `js/kde.js`; held-out scores sum
in log space for the unbounded kernels, so a tiny h scores large and
negative rather than ln 0.

## Testing

```sh
~/venv_ds4400/bin/python -I build/make_ref.py      # rewrites test/ref.js
~/venv_ds4400/bin/python test/run_headless.py "file://$PWD/test/index.html" \
    --wait '/PASS|FAIL/.test(document.title)' \
    --eval 'document.getElementById("out").textContent'
```

compares `js/kde.js` with sklearn's `KernelDensity.score_samples` for
every kernel (including a tiny-h case far from the samples) and with
5-fold held-out scores on fixed folds (Gaussian, and Epanechnikov with
−∞ entries), checks Scott's rule, kernel and truth samplers by their
moments, and the area of every kernel, truth and p̂. `run_headless.py`
also takes `--shot` screenshots; it drives playwright's Chromium
(`~/.cache/ms-playwright`), so run it outside the sandbox.

## Run locally

Open `index.html` in a browser, or serve it:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Publish on GitHub Pages

```sh
gh repo create matthigger/kde --public --source . --push
gh api -X POST repos/matthigger/kde/pages -f build_type=workflow
```

`.github/workflows/pages.yml` then deploys each push to main.
