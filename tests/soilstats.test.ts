import { describe, expect, it } from 'vitest';
import '../app/lib/soilstats.js';
import ref from './fixtures/kriging-reference.json';

const S = (globalThis as unknown as { SoilStats: typeof import('../app/lib/soilstats').SoilStats }).SoilStats;
const gridPts = (n: number, step: number, f: (x: number, y: number) => number) => Array.from({ length: n * n }, (_, i) => { const x = (i % n) * step, y = Math.floor(i / n) * step; return { x, y, v: f(x, y) }; });

describe('soil survey statistics: basics', () => {
  it('averages samples at the same spot and says how many', () => {
    const r = S.merge([{ x: 1, y: 1, v: 2 }, { x: 1, y: 1, v: 4 }, { x: 5, y: 5, v: 9 }]);
    expect(r.merged).toBe(1);
    expect(r.pts).toEqual([{ x: 1, y: 1, v: 3 }, { x: 5, y: 5, v: 9 }]);
  });
  it('measures point spacing', () => {
    expect(S.spacing(gridPts(3, 100, () => 1)).median).toBe(100);
    expect(S.spacing([{ x: 0, y: 0, v: 1 }]).n).toBe(1);
    expect(S.spacing([]).median).toBe(0);
  });
  it('gives clustered points less weight, with weights averaging one', () => {
    const pts = [{ x: 0, y: 0, v: 1 }, { x: 1, y: 0, v: 1 }, { x: 0, y: 1, v: 1 }, { x: 500, y: 500, v: 1 }, { x: 900, y: 100, v: 1 }];
    const w = S.decluster(pts, 200);
    expect(w.reduce((a, c) => a + c, 0) / w.length).toBeCloseTo(1, 9);
    expect(w[0]!).toBeLessThan(w[3]!);
  });
  it('inverse distance honours the data and stays inside its range', () => {
    const pts = gridPts(4, 50, (x, y) => x + 2 * y);
    expect(S.idw(pts, 50, 100)).toBe(250);
    const v = S.idw(pts, 33, 71), vs = pts.map(p => p.v);
    expect(v).toBeGreaterThanOrEqual(Math.min(...vs)); expect(v).toBeLessThanOrEqual(Math.max(...vs));
  });
  it('finds the nearest point', () => {
    expect(S.nearest([{ x: 0, y: 0, v: 1 }, { x: 10, y: 0, v: 2 }], 9, 0).v).toBe(2);
  });
  it('turns a log transform on only for skewed positive values', () => {
    expect(S.logT([1, 1, 1, 2, 2, 3, 3, 50, 200]).on).toBe(true);
    expect(S.logT([1, 2, 3, 4, 5, 6]).on).toBe(false);
    expect(S.logT([0, 1, 1, 1, 2, 500]).on).toBe(false);
    const t = S.logT([1, 1, 1, 2, 2, 3, 3, 50, 200]); expect(t.inv(t.fwd(7))).toBeCloseTo(7, 9);
  });
  it('round-trips sand, silt and clay so they sum to 100, even with a zero', () => {
    const [a, b] = S.alr(60, 30, 10), back = S.alrInv(a, b);
    expect(back[0]).toBeCloseTo(60, 6); expect(back[1]).toBeCloseTo(30, 6); expect(back[2]).toBeCloseTo(10, 6);
    const z = S.alrInv(...S.alr(70, 30, 0)); expect(z[0] + z[1] + z[2]).toBeCloseTo(100, 6);
    expect(Number.isFinite(z[2])).toBe(true);
  });
  it('checks a method by hiding one point at a time', () => {
    const pts = [{ x: 0, y: 0, v: 1 }, { x: 1, y: 0, v: 3 }];
    const r = S.loo(pts, () => 2);
    expect(r.rmse).toBeCloseTo(1, 9); expect(r.bias).toBeCloseTo(0, 9); expect(r.range).toBe(2); expect(r.rows.length).toBe(2);
    expect(S.loo(pts, (rest, p) => rest[0]!.v + (p.x ? 0 : 0)).rows[0]!.pred).toBe(3);
  });
  it('scores classes by percent correct', () => {
    const r = S.loo([{ x: 0, y: 0, v: 'A' }, { x: 1, y: 0, v: 'B' }], () => 'A', true);
    expect(r.pctCorrect).toBe(50);
  });
  it('copes with identical values and with no points', () => {
    const r = S.loo([{ x: 0, y: 0, v: 5 }, { x: 1, y: 0, v: 5 }], () => 5);
    expect(r.range).toBe(0); expect(r.rmse).toBe(0);
    expect(S.loo([], () => 0).rows).toEqual([]);
    expect(Number.isNaN(S.idw([], 0, 0))).toBe(true);
  });
  it('lays a grid over the points', () => {
    const g = S.grid(gridPts(2, 100, () => 1), { cell: 25, pad: 50 });
    expect([g.x0, g.y0, g.nx, g.ny, g.cell]).toEqual([-50, -50, 8, 8, 25]);
  });
  it('fades colour with distance and stops outside the survey area', () => {
    const pts = gridPts(3, 100, () => 1);
    expect(S.mask(pts, 100, 100, 100)).toBe(1);
    expect(S.mask(pts, 100, 200 + 149, 100)).toBe(1);
    expect(S.mask(pts, 100, 200 + 175, 100)).toBeCloseTo(.5, 6);
    expect(S.mask(pts, 100, 200 + 200, 100)).toBe(0);
    expect(S.mask(pts, 100, 900, 900)).toBe(0);
  });
});

/* a repeatable correlated field: Cholesky of a spherical covariance over random points */
function simulate(n: number, size: number, range: number, seed = 12345) {
  for (let i = 0; i < 20; i++) seed = (seed * 1664525 + 1013904223) % 4294967296;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296, nrm = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const xy = Array.from({ length: n }, () => [rnd() * size, rnd() * size] as const), C = (a: number, b: number) => { const h = Math.hypot(xy[a]![0] - xy[b]![0], xy[a]![1] - xy[b]![1]) / range; return (h >= 1 ? 0 : 1 - 1.5 * h + .5 * h ** 3) + (a === b ? 1e-6 : 0); };
  const L = xy.map(() => new Float64Array(n));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let t = C(i, j); for (let k = 0; k < j; k++) t -= L[i]![k]! * L[j]![k]!; L[i]![j] = i === j ? Math.sqrt(Math.max(t, 1e-12)) : t / L[j]![j]!; }
  const z = xy.map(() => nrm());
  return xy.map(([x, y], i) => ({ x, y, v: z.reduce((t, zk, k) => t + L[i]![k]! * zk, 0) }));
}

describe('soil survey statistics: kriging', () => {
  const vg = ref.vg as Parameters<typeof S.krige>[1];
  it('matches the reference solve', () => {
    for (const s of ref.spots) { const r = S.krige(ref.pts, vg, s.x, s.y); expect(r.v).toBeCloseTo(s.v, 4); expect(r.var!).toBeCloseTo(s.var, 4); }
  });
  it('honours the data at a sampled spot', () => {
    const p = ref.pts[5]!, r = S.krige(ref.pts, { ...vg, nugget: 0 }, p.x, p.y);
    expect(r.v).toBeCloseTo(p.v, 6); expect(r.var!).toBeCloseTo(0, 6);
  });
  it('kriging weights sum to one', () => {
    expect(S.krigeWeights(ref.pts, vg, 100, 100).reduce((a, c) => a + c, 0)).toBeCloseTo(1, 9);
  });
  it('falls back without throwing when the equations cannot be solved', () => {
    const r = S.krige([{ x: 0, y: 0, v: 1 }, { x: 0, y: 0, v: 3 }], { model: 'spherical', nugget: 0, sill: 1, range: 10 }, 5, 5);
    expect(r.var).toBeNull(); expect(r.v).toBeCloseTo(2, 9);
  });
  it('recovers a known variogram on average over simulated fields', () => {
    const fits = Array.from({ length: 16 }, (_, i) => S.fitVariogram(S.empirical(simulate(200, 1000, 200, (i + 1) * 7919)), { model: 'spherical' }));
    const mean = (k: 'range' | 'sill' | 'nugget') => fits.reduce((a, f) => a + f[k], 0) / fits.length;
    expect(fits.every(f => f.ok)).toBe(true);
    expect(mean('range')).toBeGreaterThan(170); expect(mean('range')).toBeLessThan(230);
    expect(mean('sill')).toBeGreaterThan(.85); expect(mean('sill')).toBeLessThan(1.15);
    expect(mean('nugget')).toBeLessThan(.1);
  });
  it('picks the better model when none is named', () => {
    expect(['spherical', 'exponential']).toContain(S.fitVariogram(S.empirical(simulate(150, 1000, 200))).model);
  });
  it('says so when no variogram can be fitted', () => {
    const flat = gridPts(4, 50, () => 5);
    expect(S.fitVariogram(S.empirical(flat)).ok).toBe(false);
    expect(S.fitVariogram(S.empirical([{ x: 0, y: 0, v: 1 }, { x: 1, y: 0, v: 2 }])).ok).toBe(false);
  });
});

describe('soil survey statistics: surfaces', () => {
  const ab = [{ x: 0, y: 0, v: 'A' }, { x: 100, y: 0, v: 'A' }, { x: 0, y: 100, v: 'B' }, { x: 100, y: 100, v: 'B' }, { x: 50, y: 50, v: 'C' }];
  it('nearest-point zones take the closest class', () => {
    expect(S.classField(ab, 5, 5, { method: 'nearest' }).cls).toBe('A');
  });
  it('indicator chances sum to one and favour the local class', () => {
    const r = S.classField(ab, 2, 98, { method: 'indicator' }), t = Object.values(r.p).reduce((a, c) => a + c, 0);
    expect(t).toBeCloseTo(1, 9); expect(r.cls).toBe('B');
  });
  it('draws a flat surface for identical values', () => {
    const f = S.surface(gridPts(4, 50, () => 5), { method: 'krige', cell: 25, vg: S.fitVariogram(S.empirical(gridPts(4, 50, () => 5))) });
    expect([...f.val].every(v => v === 5)).toBe(true);
  });
  it('returns a value, an uncertainty and a mask for every cell', () => {
    const pts = gridPts(5, 75, (x, y) => x / 10 + y / 20), f = S.surface(pts, { method: 'idw', cell: 20, spacing: 75 });
    expect(f.val.length).toBe(f.g.nx * f.g.ny); expect(f.unc.length).toBe(f.val.length); expect(f.mask.length).toBe(f.val.length);
    expect(f.val.every(Number.isFinite)).toBe(true);
  });
  it('keeps a log-transformed surface in the original units', () => {
    const pts = gridPts(4, 50, (x, y) => 1 + (x + y) ** 2 / 1000), f = S.surface(pts, { method: 'idw', cell: 25, log: true, spacing: 50 }), vs = pts.map(p => p.v);
    expect(Math.max(...f.val)).toBeLessThanOrEqual(Math.max(...vs) + 1e-3);
  });
  it('classes come back with their names', () => {
    const f = S.surface(ab, { method: 'nearest', cell: 20, spacing: 50 });
    expect(f.classes!.sort()).toEqual(['A', 'B', 'C']); expect(f.val.every(v => v >= 0 && v < 3)).toBe(true);
  });
  it('handles 2,000 points on a fine grid in reasonable time', () => {
    const pts = Array.from({ length: 2000 }, (_, i) => ({ x: (i * 7919) % 2003, y: (i * 104729) % 1999, v: i % 17 })), t = Date.now();
    S.surface(pts, { method: 'krige', cell: 10, spacing: 10, vg: { model: 'spherical', nugget: .1, sill: 1, range: 300, ok: true } });
    expect(Date.now() - t).toBeLessThan(20000);
  });
});

describe('soil survey: method defaults', () => {
  it.each([[0, 'none', 'none'], [4, 'none', 'none'], [5, 'idw', 'nearest'], [29, 'idw', 'nearest'], [30, 'krige', 'indicator'], [500, 'krige', 'indicator']])('%i points', (n, num, cls) => {
    expect(S.chooseMethod(n, 'num').method).toBe(num); expect(S.chooseMethod(n, 'class').method).toBe(cls);
    expect(S.chooseMethod(n, 'num').why).toMatch(new RegExp(`${n} point`));
  });
});

describe('soil survey: warnings', () => {
  const good = { n: 40, kind: 'num', method: 'krige', vgOk: true, cell: 20, spacing: 80, maskOff: false, pointsHidden: false, depthsCombined: false, strategy: 'grid', rmse: 1, range: 10, nonDetects: 0, mixedUnits: false, forced: false } as const;
  const ids = (c: Partial<Parameters<typeof S.warningsFor>[0]>) => S.warningsFor({ ...good, ...c }).map(w => w.id);
  it('says nothing about a sound map', () => { expect(ids({})).toEqual([]); });
  it.each<[string, Partial<Parameters<typeof S.warningsFor>[0]>]>([
    ['krige-few', { n: 25 }], ['vg-fail', { vgOk: false }], ['cell-fine', { cell: 7 }], ['mask-off', { maskOff: true }], ['points-hidden', { pointsHidden: true }],
    ['depths-combined', { depthsCombined: true }], ['targeted', { strategy: 'targeted' }], ['strategy-unstated', { strategy: '' }], ['rmse-large', { rmse: 3 }],
    ['non-detects', { nonDetects: 2 }], ['mixed-units', { mixedUnits: true }], ['forced-few', { n: 4, forced: true }],
  ])('%s', (id, c) => { expect(ids(c)).toContain(id); });
  it('does not warn at the exact limits', () => {
    expect(ids({ n: 30 })).toEqual([]); expect(ids({ cell: 8 })).toEqual([]); expect(ids({ rmse: 2.5 })).toEqual([]);
  });
  it('does not warn about kriging when another method is in use', () => { expect(ids({ n: 10, method: 'idw' })).toEqual([]); });
  it('marks which warnings print on a figure', () => {
    const w = S.warningsFor({ ...good, strategy: 'targeted', cell: 7 });
    expect(w.find(x => x.id === 'targeted')!.figure).toBe(true); expect(w.find(x => x.id === 'cell-fine')!.figure).toBe(false);
  });
  it('names how many non-detects were replaced', () => {
    expect(S.warningsFor({ ...good, nonDetects: 3 })[0]!.text).toMatch(/3 .*half the detection limit/);
  });
});

describe('soil survey: map label', () => {
  const c = { method: 'idw', n: 25, depth: '0–15 cm', date: '2026-07-22', strategy: 'grid' };
  it('always says the map is interpolated, how, and from what', () => {
    const l = S.surfaceLabel(c);
    expect(l[0]).toBe('Interpolated, not measured');
    expect(l[1]).toBe('Inverse distance, 25 points, 0–15 cm, 2026-07-22');
  });
  it('adds the targeted line', () => {
    expect(S.surfaceLabel({ ...c, strategy: 'targeted' })).toContain('Points were targeted, so this may not represent the whole site.');
  });
  it('says when the strategy is not stated', () => {
    expect(S.surfaceLabel({ ...c, strategy: '' })).toContain('Sampling strategy: not stated.');
  });
  it('names zones and kriging', () => {
    expect(S.surfaceLabel({ ...c, method: 'krige' })[1]).toMatch(/^Ordinary kriging/);
    expect(S.surfaceLabel({ ...c, method: 'nearest' })[0]).toBe('Interpolated, not measured');
    expect(S.surfaceLabel({ ...c, method: 'nearest' })[1]).toMatch(/^Nearest point zones/);
  });
});
