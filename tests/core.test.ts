import { describe, expect, it } from 'vitest';
import { llToUtm, utmToLl, zoneFromCrs, zoneOf } from '../src/core/geo';
import { classifyFines, gsdFractions, passingAt, sptCorr, sptN, sulphateClass } from '../src/core/soil';
import { exceeds, labVal } from '../src/core/lab';
import { flowPlane, geomean, hvorslev, seepage } from '../src/core/hydro';
import { niceStep } from '../src/core/util';
import type { Borehole } from '../src/core/types';

/* An independent forward projection (Snyder 1987, USGS PP 1395, eq. 8-9 to 8-11) to check the Krüger series against. */
function snyder(lat: number, lon: number, zone: number) {
  const a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f), ep2 = e2 / (1 - e2), k0 = 0.9996, ph = lat * Math.PI / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(ph) ** 2), T = Math.tan(ph) ** 2, C = ep2 * Math.cos(ph) ** 2, A = Math.cos(ph) * (lon - (zone * 6 - 183)) * Math.PI / 180;
  const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * ph - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * ph) + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * ph) - (35 * e2 ** 3 / 3072) * Math.sin(6 * ph));
  return [500000 + k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120),
    k0 * (M + N * Math.tan(ph) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720))];
}
const bh = (o: Partial<Borehole> = {}): Borehole => ({ id: 'b', name: 'BH1', layers: [], samples: [], water: [], ...o });

describe('coordinates', () => {
  const places: [number, number, number][] = [[52.1332, -106.67, 13], [53.2777, -110.005, 12], [53.5444, -113.4909, 12], [49.5, -114, 11]];
  it('puts the central meridian at 500 000 m E', () => { expect(llToUtm(52, -105, 13)[0]).toBeCloseTo(500000, 6); });
  it('agrees with an independent formula to under 1 mm across Alberta and Saskatchewan', () => {
    for (const [la, lo, z] of places) { const [e, n] = llToUtm(la, lo, z), [e2, n2] = snyder(la, lo, z); expect(Math.hypot(e - e2!, n - n2!)).toBeLessThan(0.001); }
  });
  it('round-trips UTM to latitude/longitude to under 1 mm', () => {
    for (const [la, lo, z] of places) { const [e, n] = llToUtm(la, lo, z), [la2, lo2] = utmToLl(e, n, z), [e2, n2] = llToUtm(la2, lo2, z); expect(Math.hypot(e - e2, n - n2)).toBeLessThan(0.001); }
  });
  it('finds zones', () => { expect(zoneOf(-106.67)).toBe(13); expect(zoneOf(-113.49)).toBe(12); expect(zoneFromCrs('UTM NAD83(CSRS) Zone 12')).toBe(12); expect(zoneFromCrs('3TM 114')).toBeNull(); });
});

describe('SPT', () => {
  it('N is the 2nd plus 3rd increment, else the value entered', () => { expect(sptN({ depth: 1, b1: 4, b2: 6, b3: 8 })).toBe(14); expect(sptN({ depth: 1, n: '22' })).toBe(22); expect(sptN({ depth: 1 })).toBeNull(); });
  it('corrects to N60 and (N1)60 (Youd et al. 2001)', () => {
    // ER 80 %, 200 mm hole (CB 1.15), liners (CS 1), rod length 3.0 + 1.5 = 4.5 m (CR 0.85), N = 20, γ 19, dry: σ′v = 57 kPa
    const c = sptCorr(bh({ er: 80, diameter: 200 }), { depth: 3, n: 20 })!;
    expect(c.CB).toBe(1.15); expect(c.CR).toBe(0.85);
    expect(c.N60).toBeCloseTo(20 * 80 / 60 * 1.15 * 0.85, 9);
    expect(c.CN).toBeCloseTo(Math.sqrt(100 / 57), 9);
    expect(c.N160).toBeCloseTo(26.0667 * 1.32453, 3);
  });
  it('uses effective stress below the water table and caps CN at 1.7', () => {
    const c = sptCorr(bh({ er: 60, water: [{ kind: 'static', depth: 1 }] }), { depth: 4, n: 10 })!;
    expect(c.sv).toBeCloseTo(19 * 4 - 9.81 * 3, 9);
    expect(sptCorr(bh({ er: 60 }), { depth: 0.5, n: 10 })!.CN).toBe(1.7);
  });
  it('needs the energy ratio', () => { expect(sptCorr(bh(), { depth: 3, n: 20 })).toBeNull(); });
});

describe('soil classification', () => {
  it('classifies on the plasticity chart', () => {
    expect(classifyFines(45, 20)).toBe('CI');      // PI 25 above the A-line (18.25)
    expect(classifyFines(25, 21)).toBe('CL-ML');   // PI 4, LL < 30
    expect(classifyFines(60, 40)).toBe('MH');      // PI 20 below the A-line (29.2)
    expect(classifyFines(28, 25)).toBe('ML');      // PI 3 < 4
    expect(classifyFines(20, 25)).toBe('PL > LL');
  });
  it('gives CSA A23.1 sulphate classes', () => { expect(sulphateClass(2.5)).toMatch(/^S-1/); expect(sulphateClass(0.5)).toMatch(/^S-2/); expect(sulphateClass(0.15)).toMatch(/^S-3/); expect(sulphateClass(0.05)).toBe('Negligible'); });
});

describe('grain size', () => {
  const gsd = [{ size: 19, passing: 100 }, { size: 4.75, passing: 80 }, { size: 0.075, passing: 30 }, { size: 0.002, passing: 10 }];
  it('interpolates in log size', () => { expect(passingAt(gsd, 0.6)).toBeCloseTo(30 + 50 * (Math.log(0.6 / 0.075) / Math.log(4.75 / 0.075)), 9); });
  it('splits gravel, sand, silt and clay at the CFEM limits', () => { expect(gsdFractions(gsd)).toMatchObject({ gravel: 20, sand: 50, fines: 30, silt: 20, clay: 10 }); });
  it('returns nothing below the finest sieve', () => { expect(passingAt(gsd, 0.001)).toBeNull(); });
});

describe('lab results', () => {
  const lab = (v: Record<string, [number, boolean?]>) => ({ depth: 1, lab: Object.fromEntries(Object.entries(v).map(([k, [x, lt]]) => [k, { v: x, lt }])) });
  it('calculates F1 − BTEX to the precision of F1', () => { expect(labVal(lab({ f1: [890], benzene: [3.1], toluene: [5.2], ethylbenzene: [2.4], xylenes: [6.4] }), 'f1b')).toEqual({ v: 873, lt: false }); });
  it('ignores non-detect BTEX and never goes below zero', () => {
    expect(labVal(lab({ f1: [10.5], benzene: [0.005, true], toluene: [12], ethylbenzene: [0.01, true], xylenes: [0.02, true] }), 'f1b')).toEqual({ v: 0, lt: false });
  });
  it('keeps a non-detect F1 as a non-detect', () => { expect(labVal(lab({ f1: [10, true], benzene: [1], toluene: [1], ethylbenzene: [1], xylenes: [1] }), 'f1b')).toEqual({ v: 10, lt: true }); });
  it('needs all four BTEX results', () => { expect(labVal(lab({ f1: [890], benzene: [3] }), 'f1b')).toBeNull(); });
  it('flags exceedances only for detected results', () => { expect(exceeds({ v: 12 }, 10)).toBe(true); expect(exceeds({ v: 12, lt: true }, 10)).toBe(false); expect(exceeds({ v: 8 }, 10)).toBe(false); expect(exceeds({ v: 8 }, null)).toBe(false); });
});

describe('groundwater', () => {
  it('Hvorslev K matches the closed form for an exact exponential recovery', () => {
    const T0 = 100, data = [0, 20, 50, 100, 200, 300].map(t => [t, 1.2 * Math.exp(-t / T0)] as [number, number]);
    const r = hvorslev({ data, rc: 0.025, R: 0.075, Le: 3 })!;
    expect(r.T0).toBeCloseTo(T0, 6); expect(r.r2).toBeCloseTo(1, 9); expect(r.valid).toBe(true);
    expect(r.K).toBeCloseTo(0.025 ** 2 * Math.log(3 / 0.075) / (2 * 3 * T0), 12);
  });
  it('averages K geometrically', () => { expect(geomean([1e-5, 1e-7])).toBeCloseTo(1e-6, 15); expect(geomean([])).toBeNull(); });
  it('recovers a known flow direction and gradient (127°, i = 0.008) from five wells', () => {
    const az = 127 * Math.PI / 180, i = 0.008, h = (e: number, n: number) => 500 - i * (Math.sin(az) * e + Math.cos(az) * n);
    const wells = [[0, 0], [60, 10], [20, 70], [-40, 30], [35, -45]].map(([e, n]) => ({ e: 389400 + e!, n: 5776900 + n!, h: h(e!, n!) }));
    const F = flowPlane(wells);
    if ('error' in F) throw new Error(F.error);
    expect(F.az).toBeCloseTo(127, 6); expect(F.i).toBeCloseTo(0.008, 9); expect(F.dir).toBe('SE'); expect(F.r2).toBeCloseTo(1, 9);
  });
  it('solves the three-point problem exactly', () => {
    const F = flowPlane([{ e: 0, n: 0, h: 10 }, { e: 100, n: 0, h: 9 }, { e: 0, n: 100, h: 10 }]);
    if ('error' in F) throw new Error(F.error);
    expect(F.az).toBeCloseTo(90, 9); expect(F.i).toBeCloseTo(0.01, 12);
  });
  it('refuses wells in a straight line', () => { expect(flowPlane([{ e: 0, n: 0, h: 1 }, { e: 50, n: 0.01, h: 2 }, { e: 100, n: 0, h: 3 }])).toHaveProperty('error'); });
  it('gives Darcy flux and seepage velocity', () => { const s = seepage(1e-5, 0.008, 0.25); expect(s.q).toBeCloseTo(8e-8, 18); expect(s.v).toBeCloseTo(3.2e-7, 18); });
});

describe('axis steps', () => { it('rounds to 1, 2 or 5 × 10ⁿ', () => { expect(niceStep(100, 5)).toBe(20); expect(niceStep(7.3, 5)).toBe(1); expect(niceStep(9, 5)).toBe(2); expect(niceStep(0.9, 4)).toBe(0.2); }); });
