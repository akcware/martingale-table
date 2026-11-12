/** "Nice" axis tick values (1-2-2.5-5 × 10ⁿ). Pure functions. */

export function niceStep(span: number, target: number, integer = false): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / Math.max(1, target);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  let nice: number;
  if (integer || p < 1) nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  else nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  const step = nice * p;
  return integer ? Math.max(1, Math.round(step)) : step;
}

/** Tick values that fall inside [lo, hi]. */
export function ticks(lo: number, hi: number, target: number, integer = false): number[] {
  if (!(hi > lo)) return [lo];
  const step = niceStep(hi - lo, target, integer);
  const first = Math.ceil(lo / step - 1e-9);
  const last = Math.floor(hi / step + 1e-9);
  const out: number[] = [];
  for (let k = first; k <= last && out.length < 50; k++) {
    // k*step: round away floating-point drift
    const v = k * step;
    out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  }
  return out;
}

/** Index of the value closest to `target` in an ascending array (binary search). */
export function nearestIndex(xs: ArrayLike<number>, target: number): number {
  const n = xs.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < target) lo = mid;
    else hi = mid;
  }
  return Math.abs(xs[lo] - target) <= Math.abs(xs[hi] - target) ? lo : hi;
}
