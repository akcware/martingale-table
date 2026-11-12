import type { RoundResult, SimStats } from '../engine/martingale';

/**
 * Public API of GameStage.svelte (accessed via bind:this).
 * The controller (src/lib/sim/controller.svelte.ts) calls these methods.
 *
 * This file is the contract between the simulation and the visuals.
 */
export interface StageApi {
  /**
   * Play one round with full animation: chips onto the table → wheel/ball spin → ball drops
   * into a pocket → win/loss effect. The Promise resolves once the result is visible
   * (total ≈ durationMs, anywhere from 260 ms to 2600 ms).
   * If a new spin arrives before the previous one finishes, finish (resolve) the old one at once.
   */
  spin(result: RoundResult, durationMs: number): Promise<void>;

  /**
   * No-animation / turbo mode: show the result immediately. May be called ~60 times per
   * second, so it must be cheap (no heavy effects or tweens; a short flash at most).
   * Also cancels any spin still animating (and resolves its Promise).
   */
  instant(result: RoundResult): void;

  /** Game over: 'bust' (bankroll can't cover the next stake) or 'cap' (round limit reached, survived). */
  end(stats: SimStats, last: RoundResult | null): void;

  /** Reset the table (new game). Any pending spin Promise must be resolved. */
  reset(): void;
}

/**
 * Helpers to pick the landing pocket deterministically from a round result.
 * The player always bets RED.
 *  - win  → a red pocket
 *  - lose → a black pocket, or (with probability 1/19) the green 0
 * At RTP 97.3% this matches a 37-pocket single-zero wheel exactly.
 */
export type PocketColor = 'red' | 'black' | 'green';

export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
] as const;

const RED_SET = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const RED_NUMBERS = [...RED_SET].sort((a, b) => a - b);
export const BLACK_NUMBERS = Array.from({ length: 36 }, (_, i) => i + 1).filter((n) => !RED_SET.has(n));

export function colorOf(n: number): PocketColor {
  return n === 0 ? 'green' : RED_SET.has(n) ? 'red' : 'black';
}

/** Deterministically maps a round result to the pocket number (0–36) the ball lands in. */
export function pocketFor(result: Pick<RoundResult, 'win' | 'roll' | 'winProb'>): number {
  const { win, roll, winProb } = result;
  if (win) {
    const u = winProb > 0 ? roll / winProb : 0;
    return RED_NUMBERS[Math.min(17, Math.floor(u * 18))];
  }
  const u = winProb < 1 ? (roll - winProb) / (1 - winProb) : 0;
  if (u < 1 / 19) return 0;
  const v = (u - 1 / 19) / (18 / 19);
  return BLACK_NUMBERS[Math.min(17, Math.floor(v * 18))];
}
