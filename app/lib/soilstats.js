/* Statistics behind the soil survey page: spacing, weights, interpolation and the check of how well it did. No page access and
   no dependencies, so it can be tested alone. Points are { x, y, v } in metres. */
(() => {
  const d2 = (a, x, y) => (a.x - x) ** 2 + (a.y - y) ** 2;
  const med = a => { const s = [...a].sort((p, q) => p - q), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
  function merge(pts) {
    const m = new Map(); for (const p of pts) { const k = `${p.x},${p.y}`; (m.get(k) || m.set(k, []).get(k)).push(p); }
    return { pts: [...m.values()].map(g => ({ ...g[0], v: g.reduce((t, p) => t + p.v, 0) / g.length })), merged: pts.length - m.size };
  }
  function spacing(pts) {
    const ds = pts.map((p, i) => Math.sqrt(Math.min(...pts.map((q, j) => i === j ? Infinity : d2(q, p.x, p.y) || Infinity)))).filter(Number.isFinite);
    return { median: med(ds), min: ds.length ? Math.min(...ds) : 0, max: ds.length ? Math.max(...ds) : 0, n: pts.length };
  }
  /* cell declustering: points sharing a cell share its weight; weights average 1 */
  function decluster(pts, cell = spacing(pts).median * 1.5 || 1) {
    const key = p => `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`, n = new Map();
    for (const p of pts) n.set(key(p), (n.get(key(p)) || 0) + 1);
    const w = pts.map(p => 1 / n.get(key(p))), t = w.reduce((a, c) => a + c, 0) || 1;
    return w.map(x => x * pts.length / t);
  }
  /* the k closest points, by insertion into a short list so a surface over thousands of points stays quick */
  function closest(pts, x, y, k) {
    const best = [];
    for (const p of pts) {
      const d = d2(p, x, y); if (best.length === k && d >= best[k - 1][0]) continue;
      let i = best.length === k ? k - 1 : best.length; while (i > 0 && best[i - 1][0] > d) { best[i] = best[i - 1]; i--; } best[i] = [d, p];
    }
    return best;
  }
  function idw(pts, x, y, { power = 2, k = 12 } = {}) {
    if (!pts.length) return NaN; let ws = 0, vs = 0;
    for (const [d, p] of closest(pts, x, y, k)) { if (d < 1e-9) return p.v; const w = (p.w ?? 1) / d ** (power / 2); ws += w; vs += w * p.v; }
    return vs / ws;
  }
  const nearest = (pts, x, y) => closest(pts, x, y, 1)[0]?.[1];
  function logT(vals) {
    const n = vals.length, m = vals.reduce((a, c) => a + c, 0) / (n || 1), s2 = vals.reduce((a, c) => a + (c - m) ** 2, 0) / (n || 1);
    const skew = s2 ? vals.reduce((a, c) => a + (c - m) ** 3, 0) / (n || 1) / s2 ** 1.5 : 0;
    return { fwd: Math.log, inv: Math.exp, skew, on: skew > 1 && vals.every(v => v > 0) };
  }
  /* sand, silt and clay as two log-ratios, so interpolated fractions stay positive and sum to 100; a zero is floored at 0.1 % */
  const alr = (sand, silt, clay) => { const f = v => Math.max(v, .1); return [Math.log(f(sand) / f(clay)), Math.log(f(silt) / f(clay))]; };
  const alrInv = (a, b) => { const c = 100 / (1 + Math.exp(a) + Math.exp(b)); return [c * Math.exp(a), c * Math.exp(b), c]; };
  /* leave-one-out: predict(rest, point) gives the value at a hidden point */
  function loo(pts, predict, classes = false) {
    const rows = pts.map((p, i) => { const pred = predict(pts.filter((_, j) => j !== i), p); return { i, actual: p.v, pred, err: classes ? null : pred - p.v }; });
    if (classes) return { rows, pctCorrect: rows.length ? rows.filter(r => r.pred === r.actual).length / rows.length * 100 : 0, rmse: null, bias: null, range: null };
    const n = rows.length || 1, vs = pts.map(p => p.v);
    return { rows, rmse: Math.sqrt(rows.reduce((a, r) => a + r.err ** 2, 0) / n), bias: rows.reduce((a, r) => a + r.err, 0) / n, range: vs.length ? Math.max(...vs) - Math.min(...vs) : 0 };
  }
  function grid(pts, { cell, pad = 0 }) {
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y), x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
    return { x0, y0, nx: Math.ceil((Math.max(...xs) + pad - x0) / cell), ny: Math.ceil((Math.max(...ys) + pad - y0) / cell), cell };
  }
  /* opacity by distance from the nearest point: full to 1.5 spacings, gone by 2 */
  const mask = (pts, sp, x, y) => { const d = Math.sqrt(closest(pts, x, y, 1)[0]?.[0] ?? Infinity) / (sp || 1); return d <= 1.5 ? 1 : d >= 2 ? 0 : (2 - d) / .5; };
  /* semivariance: nugget + (sill - nugget) × shape(h / range), sill being the total; zero at zero distance */
  const SHAPE = { spherical: r => r >= 1 ? 1 : 1.5 * r - .5 * r ** 3, exponential: r => 1 - Math.exp(-3 * r) };
  const gamma = (vg, h) => h === 0 ? 0 : vg.nugget + (vg.sill - vg.nugget) * SHAPE[vg.model](h / vg.range);
  function empirical(pts, { lags = 12, weights } = {}) {
    const n = pts.length; let far = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) far = Math.max(far, d2(pts[i], pts[j].x, pts[j].y));
    const w = Math.sqrt(far) / 2 / lags, bins = Array.from({ length: lags }, () => ({ h: 0, g: 0, n: 0 })); if (!w) return [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const h = Math.sqrt(d2(pts[i], pts[j].x, pts[j].y)), b = bins[Math.floor(h / w)]; if (!b) continue;
      const wt = weights ? weights[i] * weights[j] : 1; b.h += h * wt; b.g += (pts[i].v - pts[j].v) ** 2 / 2 * wt; b.n += wt;
    }
    return bins.filter(b => b.n > 0).map(b => ({ h: b.h / b.n, g: b.g / b.n, n: b.n }));
  }
  /* weighted least squares (weights n / h²): for each trial range, nugget and partial sill are a straight-line fit */
  function fitVariogram(emp, { model } = {}) {
    let best = null; const hs = emp.map(e => e.h), top = Math.max(...hs, 0);
    for (const m of model ? [model] : ['spherical', 'exponential']) for (let t = 1; t <= 60; t++) {
      const range = top * 1.5 * t / 60; if (!range) continue; let sw = 0, sf = 0, sg = 0, sff = 0, sfg = 0;
      for (const e of emp) { const w = e.n / e.h ** 2, f = SHAPE[m](e.h / range); sw += w; sf += w * f; sg += w * e.g; sff += w * f * f; sfg += w * f * e.g; }
      const det = sw * sff - sf * sf; let part = det > 1e-12 ? (sw * sfg - sf * sg) / det : 0, nugget = sw ? (sg - part * sf) / sw : 0;
      if (nugget < 0) { nugget = 0; part = sff ? sfg / sff : 0; } if (part < 0) { part = 0; nugget = sw ? sg / sw : 0; }
      const sse = emp.reduce((a, e) => a + e.n / e.h ** 2 * (e.g - nugget - part * SHAPE[m](e.h / range)) ** 2, 0);
      if (!best || sse < best.sse) best = { model: m, nugget, sill: nugget + part, range, sse, ok: part > 1e-12 && emp.length >= 3 };
    }
    return best || { model: model || 'spherical', nugget: 0, sill: 0, range: 0, sse: 0, ok: false };
  }
  /* Gaussian elimination with partial pivoting; null when the system is singular */
  function solve(A, b) {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
      if (Math.abs(A[p][i]) < 1e-10) return null;
      [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
      for (let k = i + 1; k < n; k++) { const f = A[k][i] / A[i][i]; if (f) { for (let j = i; j < n; j++) A[k][j] -= f * A[i][j]; b[k] -= f * b[i]; } }
    }
    for (let i = n - 1; i >= 0; i--) { for (let j = i + 1; j < n; j++) b[i] -= A[i][j] * b[j]; b[i] /= A[i][i]; }
    return b;
  }
  function system(pts, vg, x, y, k) {
    const near = closest(pts, x, y, k).map(c => c[1]), n = near.length, g0 = near.map(p => gamma(vg, Math.sqrt(d2(p, x, y))));
    const A = near.map(p => [...near.map(q => gamma(vg, Math.sqrt(d2(q, p.x, p.y)))), 1]); A.push([...near.map(() => 1), 0]);
    return { near, g0, x: solve(A, [...g0, 1]), n };
  }
  const krigeWeights = (pts, vg, x, y, k = 16) => { const s = system(pts, vg, x, y, k); return s.x ? s.x.slice(0, s.n) : null; };
  function krige(pts, vg, x, y, { k = 16 } = {}) {
    const s = system(pts, vg, x, y, k); if (!s.x) return { v: idw(pts, x, y, { k }), var: null };
    let v = 0, va = s.x[s.n]; for (let i = 0; i < s.n; i++) { v += s.x[i] * s.near[i].v; va += s.x[i] * s.g0[i]; }
    return { v, var: Math.max(va, 0) };
  }
  const classesOf = pts => [...new Set(pts.map(p => p.v))];
  const indicatorVgs = pts => Object.fromEntries(classesOf(pts).map(c => { const ip = pts.map(p => ({ ...p, v: p.v === c ? 1 : 0 })); return [c, fitVariogram(empirical(ip))]; }));
  /* the most likely class at a spot, with the chance of each */
  function classField(pts, x, y, { method = 'nearest', vgs } = {}) {
    if (method === 'nearest') { const c = nearest(pts, x, y).v; return { cls: c, p: { [c]: 1 } }; }
    const v = vgs || indicatorVgs(pts), p = {}; let t = 0;
    for (const c of classesOf(pts)) { const ip = pts.map(q => ({ ...q, v: q.v === c ? 1 : 0 })); p[c] = Math.max(0, Math.min(1, v[c]?.ok ? krige(ip, v[c], x, y).v : idw(ip, x, y))); t += p[c]; }
    let cls = null; for (const c in p) { p[c] = t ? p[c] / t : 0; if (cls === null || p[c] > p[cls]) cls = c; }
    return { cls, p };
  }
  /* a whole map: value, uncertainty and opacity per cell. Uncertainty: kriging standard deviation, the distance to data in
     spacings for inverse distance, the chance of being wrong for classes. o.progress(share) is called as rows finish. */
  function surface(pts, o) {
    const g = grid(pts, { cell: o.cell, pad: o.pad ?? 0 }), n = g.nx * g.ny, val = new Float32Array(n), unc = new Float32Array(n), msk = new Float32Array(n), sp = o.spacing || spacing(pts).median || o.cell;
    const isClass = o.method === 'nearest' || o.method === 'indicator', classes = isClass ? classesOf(pts) : null, vgs = o.method === 'indicator' ? indicatorVgs(pts) : null;
    const flat = !isClass && pts.every(p => p.v === pts[0]?.v), T = o.log ? logT(pts.map(p => p.v)) : null, tp = T ? pts.map(p => ({ ...p, v: T.fwd(p.v) })) : pts;
    for (let r = 0; r < g.ny; r++) for (let c = 0; c < g.nx; c++) {
      const i = r * g.nx + c, x = g.x0 + (c + .5) * g.cell, y = g.y0 + (r + .5) * g.cell; msk[i] = mask(pts, sp, x, y);
      if (flat) { val[i] = pts[0].v; continue; }
      if (isClass) { const f = classField(pts, x, y, { method: o.method, vgs }); val[i] = classes.indexOf(o.method === 'nearest' ? f.cls : classes.find(k => String(k) === f.cls)); unc[i] = 1 - f.p[f.cls]; continue; }
      if (o.method === 'krige' && o.vg?.ok) { const q = krige(tp, o.vg, x, y, { k: o.k ?? 16 }), sd = Math.sqrt(q.var ?? 0); val[i] = T ? T.inv(q.v) : q.v; unc[i] = T ? (T.inv(q.v + sd) - T.inv(q.v - sd)) / 2 : sd; continue; }
      const v = idw(tp, x, y, { power: o.power, k: o.k }); val[i] = T ? T.inv(v) : v; unc[i] = Math.sqrt(closest(pts, x, y, 1)[0][0]) / sp;
    }
    return { g, val, unc, mask: msk, ...(classes ? { classes } : {}) };
  }
  globalThis.SoilStats = { merge, spacing, decluster, idw, nearest, logT, alr, alrInv, loo, grid, mask, empirical, fitVariogram, krige, krigeWeights, classField, surface };
})();
