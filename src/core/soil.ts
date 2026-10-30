import type { Borehole, GsdPoint, Sample } from './types';

/* SPT N: blows for the 2nd and 3rd increments, else a value entered directly. */
export function sptN(s: Sample): number | null {
  if (s.b2 != null && s.b3 != null) return s.b2 + s.b3;
  const v = typeof s.n === 'string' ? parseFloat(s.n) : s.n;
  return v != null && Number.isFinite(v) ? v : null;
}

/* Shallowest stabilised water level, for effective stress. */
const waterForStress = (b: Borehole) => { const w = b.water.filter(x => x.kind !== 'strike' && x.depth != null).map(x => x.depth as number); return w.length ? Math.min(...w) : null; };

/* SPT energy and procedure corrections (Youd et al. 2001; overburden after Liao & Whitman 1986, CN <= 1.7).
   N60 = N·CE·CB·CS·CR with CE = ER/60; (N1)60 = N60·CN with CN = sqrt(Pa/σ′v), Pa = 100 kPa. */
export function sptCorr(b: Borehole, s: Sample) {
  const N = sptN(s); if (N == null || s.depth == null || b.er == null) return null;
  const CE = b.er / 60, d = b.diameter;
  const CB = d == null || d <= 115 ? 1 : d <= 150 ? 1.05 : 1.15;
  const CS = b.noLiners ? 1.2 : 1;
  const L = s.depth + (b.rodStick ?? 1.5);
  const CR = L < 3 ? 0.75 : L < 4 ? 0.8 : L < 6 ? 0.85 : L < 10 ? 0.95 : 1;
  const N60 = N * CE * CB * CS * CR;
  const zw = waterForStress(b), g = b.gamma || 19, z = s.depth;
  const sv = Math.max(1e-6, g * z - 9.81 * Math.max(0, zw == null ? 0 : z - zw));
  const CN = Math.min(1.7, Math.sqrt(100 / sv));
  return { N, CE, CB, CS, CR, N60, sv, CN, N160: N60 * CN };
}

/* Fine-grained class from Atterberg limits on the CFEM / Modified USCS plasticity chart (A-line PI = 0.73(LL − 20)). */
export function classifyFines(ll: number | null | undefined, pl: number | null | undefined): string {
  if (ll == null || pl == null) return '';
  const pi = ll - pl;
  if (pi < 0) return 'PL > LL';
  const aLine = 0.73 * (ll - 20);
  if (pi < 4 || pi < aLine) return ll < 30 ? 'ML' : ll <= 50 ? 'MI' : 'MH';
  if (pi <= 7 && ll < 30) return 'CL-ML';
  return ll < 30 ? 'CL' : ll <= 50 ? 'CI' : 'CH';
}

/* CSA A23.1 Table 3 exposure class from water-soluble sulphate in soil (% by mass). */
export const sulphateClass = (so4: number | null | undefined) => so4 == null ? '' : so4 >= 2 ? 'S-1 (very severe)' : so4 >= 0.2 ? 'S-2 (severe)' : so4 >= 0.1 ? 'S-3 (moderate)' : 'Negligible';

/* Percent passing at a sieve size, interpolated linearly in log(size) between the measured points. */
export function passingAt(gsd: GsdPoint[] | undefined, size: number): number | null {
  const pts = (gsd || []).filter((p): p is GsdPoint & { passing: number } => p.size > 0 && p.passing != null).sort((x, y) => y.size - x.size);
  const first = pts[0], last = pts[pts.length - 1];
  if (!first || !last) return null;
  if (size >= first.size) return first.passing >= 99.5 || size > first.size ? Math.max(first.passing, size > first.size ? 100 : first.passing) : first.passing;
  if (size < last.size) return null;
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i]!, q = pts[i + 1]!;
    if (size <= p.size && size >= q.size) { const t = (Math.log(size) - Math.log(q.size)) / (Math.log(p.size) - Math.log(q.size)); return q.passing + t * (p.passing - q.passing); }
  }
  return null;
}

/* CFEM size limits: gravel 75–4.75 mm, sand 4.75–0.075 mm, silt 0.075–0.002 mm, clay < 0.002 mm. */
export function gsdFractions(gsd: GsdPoint[] | undefined) {
  const p75 = passingAt(gsd, 75) ?? 100, p475 = passingAt(gsd, 4.75), p075 = passingAt(gsd, 0.075), p002 = passingAt(gsd, 0.002);
  if (p475 == null || p075 == null) return null;
  return { gravel: p75 - p475, sand: p475 - p075, fines: p075, silt: p002 == null ? null : p075 - p002, clay: p002, f02: passingAt(gsd, 0.02) };
}
