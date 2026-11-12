import { mulberry32 } from './rng.ts';
import type { SimConfig } from './martingale.ts';

/** Closed-form values that need no simulation. */
export interface Theory {
  winProb: number;
  lossProb: number;
  /** Expected loss per unit staked (house edge), e.g. 0.027 */
  houseEdge: number;
  /** Consecutive losses that bust the starting bankroll */
  maxLossStreak: number;
  /** Last (largest) stake in that streak, cents */
  maxStake: number;
  /** Stake required after that many losses (cannot be covered), cents */
  firstUncoveredStake: number;
  /** Probability that a single Martingale cycle busts = q^n */
  cycleBustProb: number;
  /** Average rounds per cycle (until a win) */
  roundsPerCycle: number;
  /**
   * Rough expected bust round, assuming the streak limit stays fixed.
   * The limit can grow as the balance grows, so the real value tends to be longer.
   */
  expectedBustRoundApprox: number;
}

export function theory(cfg: Pick<SimConfig, 'rtp' | 'startBalance' | 'baseBet'>): Theory {
  const p = Math.min(1, Math.max(0, cfg.rtp / 200));
  const q = 1 - p;
  // After n straight losses the total lost is base * (2^n - 1); the next stake is base * 2^n.
  // The strategy busts once balance < base * 2^n.
  // Number of consecutive stakes the bankroll can cover: the largest k with base * (2^k - 1) ≤ B.
  let k = 0;
  while (cfg.baseBet * (2 ** (k + 1) - 1) <= cfg.startBalance && k < 60) k++;
  const cycleBust = q ** k;
  const roundsPerCycle = q < 1 ? (1 - q ** k) / (1 - q) : k;
  const expected = cycleBust > 0 ? roundsPerCycle / cycleBust : Infinity;
  return {
    winProb: p,
    lossProb: q,
    houseEdge: 1 - cfg.rtp / 100,
    maxLossStreak: k,
    maxStake: k > 0 ? cfg.baseBet * 2 ** (k - 1) : 0,
    firstUncoveredStake: cfg.baseBet * 2 ** k,
    cycleBustProb: cycleBust,
    roundsPerCycle,
    expectedBustRoundApprox: expected,
  };
}

export interface MonteCarloResult {
  /** Completed simulations */
  sims: number;
  busted: number;
  capped: number;
  /** Bust-round statistics over the simulations that busted */
  mean: number;
  median: number;
  p10: number;
  p90: number;
  min: number;
  max: number;
  /** Mean / median peak profit across all simulations (cents) */
  meanPeakProfit: number;
  medianPeakProfit: number;
  /** Share of simulations that never got above the starting balance */
  neverProfitRatio: number;
  elapsedMs: number;
  /** Bust rounds, ascending — for percentile comparisons */
  sortedBust: number[];
  /** True if the time budget ran out before the target count */
  truncated: boolean;
  perSimCap: number;
}

interface McOptions {
  sims?: number;
  budgetMs?: number;
  perSimCap?: number;
  signal?: { aborted: boolean };
  onProgress?: (done: number) => void;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

/**
 * Plays many independent games with the same settings and reports the bust-round distribution.
 * Yields to the event loop periodically so the UI stays responsive.
 */
export async function monteCarlo(cfg: SimConfig, opts: McOptions = {}): Promise<MonteCarloResult | null> {
  const target = opts.sims ?? 1000;
  const budget = opts.budgetMs ?? 2500;
  const perSimCap = Math.min(cfg.maxRounds, opts.perSimCap ?? 2_000_000);
  const p = cfg.rtp / 200;
  const base = cfg.baseBet;
  const start = cfg.startBalance;

  const bustRounds: number[] = [];
  const peakProfits: number[] = [];
  let capped = 0;
  let never = 0;
  const t0 = performance.now();
  let slice = performance.now();
  let sims = 0;

  for (let s = 0; s < target; s++) {
    if (opts.signal?.aborted) return null;
    if (performance.now() - t0 > budget && sims >= 30) break;
    if (performance.now() - slice > 30) {
      opts.onProgress?.(sims);
      await new Promise((r) => setTimeout(r, 0));
      slice = performance.now();
      if (opts.signal?.aborted) return null;
    }

    const rng = mulberry32((cfg.seed ^ Math.imul(s + 1, 0x9e3779b1)) >>> 0);
    let bal = start;
    let bet = base;
    let peak = start;
    let r = 0;
    let busted = false;
    while (r < perSimCap) {
      r++;
      if (rng() < p) {
        bal += bet;
        bet = base;
        if (bal > peak) peak = bal;
      } else {
        bal -= bet;
        bet *= 2;
        if (bal < bet) {
          busted = true;
          break;
        }
      }
    }
    sims++;
    if (busted) bustRounds.push(r);
    else capped++;
    const pp = peak - start;
    peakProfits.push(pp);
    if (pp <= 0) never++;
  }

  bustRounds.sort((a, b) => a - b);
  peakProfits.sort((a, b) => a - b);
  const mean = bustRounds.length ? bustRounds.reduce((a, b) => a + b, 0) / bustRounds.length : 0;
  const meanPeak = peakProfits.length ? peakProfits.reduce((a, b) => a + b, 0) / peakProfits.length : 0;

  return {
    sims,
    busted: bustRounds.length,
    capped,
    mean,
    median: quantile(bustRounds, 0.5),
    p10: quantile(bustRounds, 0.1),
    p90: quantile(bustRounds, 0.9),
    min: bustRounds[0] ?? 0,
    max: bustRounds[bustRounds.length - 1] ?? 0,
    meanPeakProfit: meanPeak,
    medianPeakProfit: quantile(peakProfits, 0.5),
    neverProfitRatio: sims ? never / sims : 0,
    elapsedMs: performance.now() - t0,
    sortedBust: bustRounds,
    truncated: sims < target,
    perSimCap,
  };
}

/** Share of busted simulations (0..1) that busted before the given round */
export function percentileOf(sorted: number[], round: number): number {
  if (!sorted.length) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < round) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}
