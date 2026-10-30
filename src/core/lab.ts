import type { LabResult, Sample } from './types';

const BTEX = ['benzene', 'toluene', 'ethylbenzene', 'xylenes'] as const;

/* One result for a parameter. F1 − BTEX ('f1b') is calculated: F1 minus the detected BTEX results,
   never below zero and never more precise than the F1 result; a non-detect F1 gives a non-detect F1 − BTEX. */
export function labVal(sm: Sample, p: string): LabResult | null {
  const L = sm.lab || {};
  if (p !== 'f1b') { const r = L[p]; return r && r.v != null ? r : null; }
  const f1 = L.f1;
  if (!f1 || f1.v == null || !BTEX.every(k => L[k] && L[k]!.v != null)) return null;
  if (f1.lt) return { v: f1.v, lt: true };
  const sub = BTEX.reduce((t, k) => t + (L[k]!.lt ? 0 : (L[k]!.v as number)), 0);
  const dp = (String(f1.v).split('.')[1] || '').length;
  return { v: +Math.max(0, f1.v - sub).toFixed(dp), lt: false };
}

/* A detected result above the guideline; non-detects never exceed. */
export const exceeds = (r: LabResult | null, guideline: number | null | undefined) => !!r && !r.lt && guideline != null && r.v != null && r.v > guideline;
