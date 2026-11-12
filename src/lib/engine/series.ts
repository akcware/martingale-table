/**
 * Fixed-size, self-compacting buffer for the balance time series.
 * When full, neighbouring buckets are merged (bucket size doubles). Each bucket
 * keeps min / max / last, so millions of rounds can be drawn with at most
 * `capacity` points without losing spikes.
 *
 * Values are in dollars (cents / 100).
 */
export interface SeriesView {
  n: number;
  /** Last round in the bucket */
  x: number[];
  min: number[];
  max: number[];
  /** Last balance in the bucket */
  last: number[];
  /** Total rounds so far */
  lastRound: number;
  bucketSize: number;
}

export class SeriesBuffer {
  readonly capacity: number;
  bucketSize = 1;
  private x: number[] = [];
  private mn: number[] = [];
  private mx: number[] = [];
  private ls: number[] = [];
  // Bucket currently being filled
  private cCount = 0;
  private cMin = Infinity;
  private cMax = -Infinity;
  private cLast = 0;
  private cX = 0;

  constructor(capacity = 2048) {
    this.capacity = capacity;
  }

  reset(startValue: number) {
    this.bucketSize = 1;
    this.x = [0];
    this.mn = [startValue];
    this.mx = [startValue];
    this.ls = [startValue];
    this.cCount = 0;
    this.cMin = Infinity;
    this.cMax = -Infinity;
    this.cLast = startValue;
    this.cX = 0;
  }

  push(round: number, value: number) {
    if (value < this.cMin) this.cMin = value;
    if (value > this.cMax) this.cMax = value;
    this.cLast = value;
    this.cX = round;
    if (++this.cCount >= this.bucketSize) this.commit();
  }

  private commit() {
    this.x.push(this.cX);
    this.mn.push(this.cMin);
    this.mx.push(this.cMax);
    this.ls.push(this.cLast);
    this.cCount = 0;
    this.cMin = Infinity;
    this.cMax = -Infinity;
    if (this.x.length >= this.capacity) this.compact();
  }

  private compact() {
    const n = this.x.length;
    const x: number[] = [this.x[0]];
    const mn: number[] = [this.mn[0]];
    const mx: number[] = [this.mx[0]];
    const ls: number[] = [this.ls[0]];
    // Point 0 (the start) is kept; the rest are merged in pairs
    for (let i = 1; i < n; i += 2) {
      const j = Math.min(i + 1, n - 1);
      x.push(this.x[j]);
      mn.push(Math.min(this.mn[i], this.mn[j]));
      mx.push(Math.max(this.mx[i], this.mx[j]));
      ls.push(this.ls[j]);
    }
    this.x = x;
    this.mn = mn;
    this.mx = mx;
    this.ls = ls;
    this.bucketSize *= 2;
  }

  /** Snapshot for drawing (includes the partial bucket). */
  view(): SeriesView {
    const x = this.x.slice();
    const min = this.mn.slice();
    const max = this.mx.slice();
    const last = this.ls.slice();
    if (this.cCount > 0) {
      x.push(this.cX);
      min.push(this.cMin);
      max.push(this.cMax);
      last.push(this.cLast);
    }
    return {
      n: x.length,
      x,
      min,
      max,
      last,
      lastRound: x[x.length - 1] ?? 0,
      bucketSize: this.bucketSize,
    };
  }
}
