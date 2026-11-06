import { describe, expect, it } from 'vitest';
import '../app/lib/soilstats.js';

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
