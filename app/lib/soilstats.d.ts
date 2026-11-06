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
};
