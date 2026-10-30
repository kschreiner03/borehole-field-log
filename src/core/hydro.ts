import type { SlugTest } from './types';

/* Hvorslev (1951) slug / bail test: K = rc²·ln(Le/R) / (2·Le·T0), T0 from the least-squares line of ln(h/H0)
   against time. Valid for Le/R > 8. */
export function hvorslev(t: SlugTest) {
  const H0 = t.H0 || t.data?.[0]?.[1];
  if (!H0) return null;
  const pts = (t.data || []).filter(([x, h]) => x >= 0 && h > 0).map(([x, h]) => [x, Math.log(h / H0)] as const);
  if (pts.length < 3 || !(t.rc! > 0) || !(t.R! > 0) || !(t.Le! > 0)) return null;
  const n = pts.length, sx = pts.reduce((a, p) => a + p[0], 0), sy = pts.reduce((a, p) => a + p[1], 0);
  const sxx = pts.reduce((a, p) => a + p[0] * p[0], 0), sxy = pts.reduce((a, p) => a + p[0] * p[1], 0);
  const m = (n * sxy - sx * sy) / (n * sxx - sx * sx), c = (sy - m * sx) / n;
  if (!(m < 0)) return null;
  const my = sy / n, ssT = pts.reduce((a, p) => a + (p[1] - my) ** 2, 0), ssR = pts.reduce((a, p) => a + (p[1] - (m * p[0] + c)) ** 2, 0);
  const T0 = -1 / m, K = t.rc! * t.rc! * Math.log(t.Le! / t.R!) / (2 * t.Le! * T0);
  return { K, T0, m, c, r2: ssT ? 1 - ssR / ssT : 1, H0, valid: t.Le! / t.R! > 8, n };
}

/* Geometric mean, the usual average for hydraulic conductivity. */
export const geomean = (ks: number[]) => ks.length ? Math.exp(ks.reduce((t, k) => t + Math.log(k), 0) / ks.length) : null;

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export interface Head { e: number; n: number; h: number }

/* Groundwater flow from hydraulic heads: the three-point problem for 3 wells, a least-squares plane for more.
   Flow runs down the gradient: azimuth of −∇h, gradient i = |∇h|. Refuses wells that are nearly in a line. */
export function flowPlane(wells: Head[]) {
  const N = wells.length;
  if (N < 3) return { error: 'Needs water levels in at least three wells with coordinates and ground elevations.' } as const;
  const E0 = wells.reduce((a, w) => a + w.e, 0) / N, N0 = wells.reduce((a, w) => a + w.n, 0) / N;
  let sxx = 0, syy = 0, sxy = 0, sxh = 0, syh = 0, sh = 0;
  for (const w of wells) { const x = w.e - E0, y = w.n - N0; sxx += x * x; syy += y * y; sxy += x * y; sxh += x * w.h; syh += y * w.h; sh += w.h; }
  const det = sxx * syy - sxy * sxy, tr = sxx + syy, lmin = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det)), lmax = tr - lmin;
  if (!(lmax > 0) || lmin / lmax < 0.004) return { error: 'The wells are almost in a straight line, so a flow direction cannot be defined. Use wells that form a triangle around the area.' } as const;
  const bx = (sxh * syy - syh * sxy) / det, by = (syh * sxx - sxh * sxy) / det, a = sh / N;
  const fit = (w: { e: number; n: number }) => a + bx * (w.e - E0) + by * (w.n - N0);
  let ssr = 0, sst = 0; for (const w of wells) { ssr += (w.h - fit(w)) ** 2; sst += (w.h - a) ** 2; }
  const i = Math.hypot(bx, by), az = (Math.atan2(-bx, -by) * 180 / Math.PI + 360) % 360;
  return { E0, N0, a, bx, by, i, az, dir: COMPASS[Math.round(az / 22.5) % 16]!, r2: N > 3 && sst > 0 ? 1 - ssr / sst : null, rmse: N > 3 ? Math.sqrt(ssr / (N - 3 || 1)) : 0, fit, flat: i < 1e-4, n: N };
}

/* Darcy flux q = K·i and average linear velocity v = K·i / nₑ. */
export const seepage = (K: number, i: number, ne: number) => ({ q: K * i, v: K * i / ne });
