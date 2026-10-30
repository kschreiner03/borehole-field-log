/* A round axis step (1, 2 or 5 × 10ⁿ) giving about `target` divisions of `range`. */
export function niceStep(range: number, target: number) {
  const raw = range / Math.max(1, target), p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}
