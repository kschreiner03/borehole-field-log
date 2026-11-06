export type VgModel = 'spherical' | 'exponential';
export interface Variogram { model: VgModel; nugget: number; sill: number; range: number; sse?: number; ok?: boolean }
export interface EmpRow { h: number; g: number; n: number }
export interface Surface { g: { x0: number; y0: number; nx: number; ny: number; cell: number }; val: Float32Array; unc: Float32Array; mask: Float32Array; classes?: string[] }
export interface Pt<V = number> { x: number; y: number; v: V; w?: number }
export interface LooRow<V> { i: number; actual: V; pred: V; err: number | null }
export interface Loo<V> { rows: LooRow<V>[]; rmse: number | null; bias: number | null; range: number | null; pctCorrect?: number }
export const SoilStats: {
  merge(pts: Pt[]): { pts: Pt[]; merged: number };
  spacing(pts: Pt[]): { median: number; min: number; max: number; n: number };
  decluster(pts: Pt[], cell?: number): number[];
  idw(pts: Pt[], x: number, y: number, o?: { power?: number; k?: number }): number;
  nearest<V>(pts: Pt<V>[], x: number, y: number): Pt<V>;
  logT(vals: number[]): { fwd(v: number): number; inv(v: number): number; skew: number; on: boolean };
  alr(sand: number, silt: number, clay: number): [number, number];
  alrInv(a: number, b: number): [number, number, number];
  loo<V>(pts: Pt<V>[], predict: (rest: Pt<V>[], p: Pt<V>) => V, classes?: boolean): Loo<V>;
  grid(pts: Pt<unknown>[], o: { cell: number; pad?: number }): { x0: number; y0: number; nx: number; ny: number; cell: number };
  mask(pts: Pt<unknown>[], spacing: number, x: number, y: number): number;
  chooseMethod(n: number, kind: 'num' | 'class'): { method: 'none' | 'idw' | 'krige' | 'nearest' | 'indicator'; why: string };
  warningsFor(c: { n: number; kind: string; method: string; vgOk?: boolean; cell: number; spacing: number; maskOff?: boolean; pointsHidden?: boolean; depthsCombined?: boolean; strategy: string; rmse?: number | null; range?: number | null; nonDetects?: number; mixedUnits?: boolean; forced?: boolean }): { id: string; text: string; figure: boolean }[];
  surfaceLabel(c: { method: string; n: number; depth?: string; date?: string; strategy: string }): string[];
  empirical(pts: Pt[], o?: { lags?: number; weights?: number[] }): EmpRow[];
  fitVariogram(emp: EmpRow[], o?: { model?: VgModel }): Variogram;
  krige(pts: Pt[], vg: Variogram, x: number, y: number, o?: { k?: number }): { v: number; var: number | null };
  krigeWeights(pts: Pt[], vg: Variogram, x: number, y: number, k?: number): number[];
  classField(pts: Pt<string>[], x: number, y: number, o?: { method?: 'nearest' | 'indicator'; vgs?: Record<string, Variogram> }): { cls: string; p: Record<string, number> };
  surface<V>(pts: Pt<V>[], o: { method: 'idw' | 'krige' | 'nearest' | 'indicator'; cell: number; pad?: number; spacing?: number; power?: number; k?: number; log?: boolean; vg?: Variogram }): Surface;
};
