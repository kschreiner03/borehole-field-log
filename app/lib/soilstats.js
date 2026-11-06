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
  const closest = (pts, x, y, k) => pts.map(p => [d2(p, x, y), p]).sort((a, b) => a[0] - b[0]).slice(0, k);
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
  globalThis.SoilStats = { merge, spacing, decluster, idw, nearest, logT, alr, alrInv, loo, grid, mask };
})();
