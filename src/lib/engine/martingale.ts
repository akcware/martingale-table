import { mulberry32 } from './rng.ts';

/**
 * Martingale engine — pure TypeScript, no UI dependencies.
 *
 * Rules:
 *  - Every round is an even-money (2x payout) bet: a win pays exactly the stake.
 *  - Win probability = RTP / 2  (e.g. RTP 97.3% → 48.65%, i.e. betting red on a single-zero wheel).
 *  - After a win the stake resets to the base bet; after a loss it doubles.
 *  - BUST: when the stake required for the next round is larger than the remaining
 *    balance, the strategy cannot continue. The game ends on that round
 *    (the leftover balance is reported).
 *  - All money values are integer CENTS.
 */

export interface SimConfig {
  /** Percent, e.g. 97.3 */
  rtp: number;
  /** cents */
  startBalance: number;
  /** cents */
  baseBet: number;
  seed: number;
  maxRounds: number;
}

export type EndReason = 'bust' | 'cap';

export interface RoundResult {
  /** 1-based */
  round: number;
  /** Stake placed this round (cents) */
  bet: number;
  win: boolean;
  /** Random draw for this round in [0,1). win ⇔ roll < winProb */
  roll: number;
  winProb: number;
  balanceBefore: number;
  balanceAfter: number;
  /** +bet or -bet */
  net: number;
  /** Consecutive losses after this round (0 after a win) */
  lossStreak: number;
  /** Stake required for the next round */
  nextBet: number;
  /** Did this round set a new peak balance */
  isNewPeak: boolean;
  /** Why the game ended on this round, if it did */
  ended: EndReason | null;
}

export interface SimStats {
  startBalance: number;
  baseBet: number;
  winProb: number;
  round: number;
  balance: number;
  nextBet: number;
  lossStreak: number;
  longestLossStreak: number;
  longestLossStreakEndRound: number;
  wins: number;
  losses: number;
  totalWagered: number;
  totalReturned: number;
  biggestBet: number;
  biggestBetRound: number;
  /** Highest balance and the round it happened (0 = start) */
  peakBalance: number;
  peakRound: number;
  /** Biggest single-round win and its round */
  biggestWin: number;
  biggestWinRound: number;
  lowestBalance: number;
  lowestRound: number;
  ended: EndReason | null;
}

export function validateConfig(cfg: SimConfig): string | null {
  if (!Number.isFinite(cfg.rtp) || cfg.rtp <= 0 || cfg.rtp > 200) return 'RTP must be between 0 and 200.';
  if (!Number.isInteger(cfg.startBalance) || cfg.startBalance <= 0) return 'Balance must be greater than 0.';
  if (!Number.isInteger(cfg.baseBet) || cfg.baseBet <= 0) return 'Base bet must be greater than 0.';
  if (cfg.baseBet > cfg.startBalance) return 'Base bet cannot exceed the balance.';
  if (cfg.startBalance > 1e15) return 'Balance is too large.';
  if (!Number.isInteger(cfg.maxRounds) || cfg.maxRounds < 1) return 'Round limit must be at least 1.';
  return null;
}

const TAIL = 128; // keep the last N rounds in a ring buffer

export class MartingaleEngine {
  readonly cfg: SimConfig;
  readonly winProb: number;
  private rng: () => number;

  round = 0;
  balance: number;
  nextBet: number;
  lossStreak = 0;
  longestLossStreak = 0;
  longestLossStreakEndRound = 0;
  wins = 0;
  losses = 0;
  totalWagered = 0;
  totalReturned = 0;
  biggestBet = 0;
  biggestBetRound = 0;
  peakBalance: number;
  peakRound = 0;
  biggestWin = 0;
  biggestWinRound = 0;
  lowestBalance: number;
  lowestRound = 0;
  ended: EndReason | null = null;

  // Ring buffer of recent rounds (written without allocating objects)
  private tRound = new Float64Array(TAIL);
  private tBet = new Float64Array(TAIL);
  private tRoll = new Float64Array(TAIL);
  private tBefore = new Float64Array(TAIL);
  private tAfter = new Float64Array(TAIL);
  private tStreak = new Float64Array(TAIL);
  private tNext = new Float64Array(TAIL);
  private tFlags = new Uint8Array(TAIL); // bit0 win, bit1 newPeak, bit2 bust, bit3 cap

  constructor(cfg: SimConfig) {
    const err = validateConfig(cfg);
    if (err) throw new Error(err);
    this.cfg = { ...cfg };
    this.winProb = cfg.rtp / 200;
    this.rng = mulberry32(cfg.seed);
    this.balance = cfg.startBalance;
    this.nextBet = cfg.baseBet;
    this.peakBalance = cfg.startBalance;
    this.lowestBalance = cfg.startBalance;
  }

  /** Fast step — allocates nothing. Returns false if the game has already ended. */
  stepFast(): boolean {
    if (this.ended !== null) return false;
    const bet = this.nextBet;
    const before = this.balance;
    const roll = this.rng();
    const r = ++this.round;
    this.totalWagered += bet;
    if (bet > this.biggestBet) {
      this.biggestBet = bet;
      this.biggestBetRound = r;
    }
    let flags = 0;
    if (roll < this.winProb) {
      flags |= 1;
      this.balance = before + bet;
      this.totalReturned += bet * 2;
      this.wins++;
      this.lossStreak = 0;
      this.nextBet = this.cfg.baseBet;
      if (bet > this.biggestWin) {
        this.biggestWin = bet;
        this.biggestWinRound = r;
      }
      if (this.balance > this.peakBalance) {
        this.peakBalance = this.balance;
        this.peakRound = r;
        flags |= 2;
      }
    } else {
      this.balance = before - bet;
      this.losses++;
      const s = ++this.lossStreak;
      if (s > this.longestLossStreak) {
        this.longestLossStreak = s;
        this.longestLossStreakEndRound = r;
      }
      this.nextBet = bet * 2;
      if (this.balance < this.lowestBalance) {
        this.lowestBalance = this.balance;
        this.lowestRound = r;
      }
    }
    if (this.balance < this.nextBet) {
      this.ended = 'bust';
      flags |= 4;
    } else if (r >= this.cfg.maxRounds) {
      this.ended = 'cap';
      flags |= 8;
    }
    const i = r % TAIL;
    this.tRound[i] = r;
    this.tBet[i] = bet;
    this.tRoll[i] = roll;
    this.tBefore[i] = before;
    this.tAfter[i] = this.balance;
    this.tStreak[i] = this.lossStreak;
    this.tNext[i] = this.nextBet;
    this.tFlags[i] = flags;
    return true;
  }

  /** Play one round and return its result, or null if the game has ended. */
  step(): RoundResult | null {
    if (!this.stepFast()) return null;
    return this.resultAt(this.round)!;
  }

  private resultAt(round: number): RoundResult | null {
    if (round < 1 || round > this.round || round <= this.round - TAIL) return null;
    const i = round % TAIL;
    const f = this.tFlags[i];
    const bet = this.tBet[i];
    const win = (f & 1) !== 0;
    return {
      round,
      bet,
      win,
      roll: this.tRoll[i],
      winProb: this.winProb,
      balanceBefore: this.tBefore[i],
      balanceAfter: this.tAfter[i],
      net: win ? bet : -bet,
      lossStreak: this.tStreak[i],
      nextBet: this.tNext[i],
      isNewPeak: (f & 2) !== 0,
      ended: f & 4 ? 'bust' : f & 8 ? 'cap' : null,
    };
  }

  lastResult(): RoundResult | null {
    return this.resultAt(this.round);
  }

  /** Last n rounds, newest first. */
  recent(n: number): RoundResult[] {
    const out: RoundResult[] = [];
    const lim = Math.min(n, TAIL - 1, this.round);
    for (let k = 0; k < lim; k++) {
      const res = this.resultAt(this.round - k);
      if (res) out.push(res);
    }
    return out;
  }

  stats(): SimStats {
    return {
      startBalance: this.cfg.startBalance,
      baseBet: this.cfg.baseBet,
      winProb: this.winProb,
      round: this.round,
      balance: this.balance,
      nextBet: this.nextBet,
      lossStreak: this.lossStreak,
      longestLossStreak: this.longestLossStreak,
      longestLossStreakEndRound: this.longestLossStreakEndRound,
      wins: this.wins,
      losses: this.losses,
      totalWagered: this.totalWagered,
      totalReturned: this.totalReturned,
      biggestBet: this.biggestBet,
      biggestBetRound: this.biggestBetRound,
      peakBalance: this.peakBalance,
      peakRound: this.peakRound,
      biggestWin: this.biggestWin,
      biggestWinRound: this.biggestWinRound,
      lowestBalance: this.lowestBalance,
      lowestRound: this.lowestRound,
      ended: this.ended,
    };
  }
}
