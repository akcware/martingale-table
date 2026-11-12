import { MartingaleEngine, validateConfig, type RoundResult, type SimConfig, type SimStats } from '../engine/martingale';
import { SeriesBuffer } from '../engine/series';
import { monteCarlo, theory, type MonteCarloResult, type Theory } from '../engine/analysis';
import { randomSeed } from '../engine/rng';
import { toCents } from '../engine/format';
import type { StageApi } from '../stage/types';

export type Phase = 'setup' | 'running' | 'paused' | 'finished';

export type Speed =
  | { id: string; label: string; hint: string; kind: 'anim'; spinMs: number; holdMs: number }
  | { id: string; label: string; hint: string; kind: 'turbo'; perSec: number };

export const SPEEDS: Speed[] = [
  { id: '1x', label: '1×', hint: 'Real-time', kind: 'anim', spinMs: 2600, holdMs: 700 },
  { id: '2x', label: '2×', hint: '2× faster', kind: 'anim', spinMs: 1300, holdMs: 350 },
  { id: '4x', label: '4×', hint: '4× faster', kind: 'anim', spinMs: 650, holdMs: 140 },
  { id: '10x', label: '10×', hint: '10× faster', kind: 'anim', spinMs: 260, holdMs: 50 },
  { id: 't50', label: '50/s', hint: '50 rounds per second', kind: 'turbo', perSec: 50 },
  { id: 't500', label: '500/s', hint: '500 rounds per second', kind: 'turbo', perSec: 500 },
  { id: 't5k', label: '5k/s', hint: '5,000 rounds per second', kind: 'turbo', perSec: 5000 },
  { id: 'max', label: 'MAX', hint: 'As fast as possible', kind: 'turbo', perSec: Infinity },
];

export interface Inputs {
  /** dollars */
  balance: number;
  /** dollars */
  baseBet: number;
  /** % */
  rtp: number;
  seed: number;
  maxRounds: number;
}

export const RTP_PRESETS = [
  { label: 'Single zero', rtp: 97.3 },
  { label: 'Double zero', rtp: 94.74 },
  { label: 'Fair game', rtp: 100 },
];

const HISTORY = 60;
const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class SimController {
  inputs = $state<Inputs>({ balance: 1000, baseBet: 1, rtp: 97.3, seed: randomSeed(), maxRounds: 10_000_000 });
  phase = $state<Phase>('setup');
  speedIdx = $state(0);
  skipping = $state(false);

  stats = $state.raw<SimStats | null>(null);
  last = $state.raw<RoundResult | null>(null);
  history = $state.raw<RoundResult[]>([]);
  /** Stake on the table while a spin animates (shown as deducted from the balance) */
  onTable = $state.raw<{ round: number; bet: number; balanceBefore: number } | null>(null);
  seriesVersion = $state(0);
  showSummary = $state(false);
  error = $state<string | null>(null);

  mc = $state.raw<MonteCarloResult | null>(null);
  mcBusy = $state(false);

  readonly series = new SeriesBuffer(2048);
  stage: StageApi | null = null;

  private engine: MartingaleEngine | null = null;
  private runToken = 0;
  private looping = false;
  private acc = 0;
  private lastTs = 0;
  private mcSignal = { aborted: false };
  /** Cuts short the wait on an animating round (skip to end / switch to turbo) */
  private interrupt: (() => void) | null = null;
  private mcTimer: ReturnType<typeof setTimeout> | undefined;

  // ——— Derived values ———

  config = $derived.by<SimConfig>(() => ({
    rtp: Number(this.inputs.rtp),
    startBalance: toCents(Number(this.inputs.balance)),
    baseBet: toCents(Number(this.inputs.baseBet)),
    seed: Math.floor(Number(this.inputs.seed)) >>> 0,
    maxRounds: Math.max(1, Math.floor(Number(this.inputs.maxRounds))),
  }));

  configError = $derived(validateConfig(this.config));

  theory = $derived.by<Theory | null>(() => (this.configError ? null : theory(this.config)));

  speed = $derived(SPEEDS[this.speedIdx]);

  /** Balance shown on screen: while a round spins, the stake is on the table and deducted */
  displayBalance = $derived.by(() => {
    if (this.onTable) return this.onTable.balanceBefore - this.onTable.bet;
    return this.stats?.balance ?? this.config.startBalance;
  });

  /**
   * With the current balance and streak, how many more straight losses can be absorbed before busting
   * (doubling from the next stake until the running total exceeds the balance).
   */
  survivableLosses = $derived.by(() => {
    const s = this.stats;
    if (!s) return this.theory?.maxLossStreak ?? 0;
    let bet = s.nextBet;
    let left = s.balance;
    let j = 0;
    while (bet <= left && j < 64) {
      left -= bet;
      bet *= 2;
      j++;
    }
    return j;
  });

  /** Next stake (to be placed on the table) */
  nextBet = $derived(this.onTable?.bet ?? this.stats?.nextBet ?? this.config.baseBet);

  // ——— Monte Carlo (re-runs automatically when settings change) ———

  scheduleMonteCarlo() {
    clearTimeout(this.mcTimer);
    this.mcSignal.aborted = true;
    if (this.configError) {
      this.mc = null;
      this.mcBusy = false;
      return;
    }
    // Monte Carlo is independent of the user's seed (no need to recompute when the seed changes)
    const cfg = { ...this.config, seed: 0x5eed1234 };
    this.mcBusy = true;
    this.mcTimer = setTimeout(async () => {
      const signal = { aborted: false };
      this.mcSignal = signal;
      const res = await monteCarlo(cfg, { sims: 1000, budgetMs: 2500, signal });
      if (signal.aborted) return;
      this.mc = res;
      this.mcBusy = false;
    }, 350);
  }

  // ——— Game flow ———

  /** Prepare the engine (the game starts paused) */
  private prepare(): boolean {
    this.error = null;
    if (this.configError) {
      this.error = this.configError;
      return false;
    }
    this.hardReset(false);
    this.engine = new MartingaleEngine(this.config);
    this.series.reset(this.config.startBalance / 100);
    this.stats = this.engine.stats();
    this.seriesVersion++;
    this.phase = 'paused';
    return true;
  }

  start() {
    if (!this.prepare()) return;
    this.phase = 'running';
    this.ensureLoop();
  }

  pause() {
    if (this.phase === 'running') this.phase = 'paused';
    this.skipping = false;
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.phase = 'running';
    this.ensureLoop();
  }

  toggle() {
    if (this.phase === 'setup' || this.phase === 'finished') this.start();
    else if (this.phase === 'running') this.pause();
    else this.resume();
  }

  /** Play a single round while paused */
  async stepOnce() {
    if (this.phase === 'setup' || this.phase === 'finished') {
      if (!this.prepare()) return;
    }
    if (this.phase !== 'paused' || this.looping || !this.engine) return;
    this.looping = true;
    const token = this.runToken;
    const sp = this.speed.kind === 'anim' ? this.speed : (SPEEDS[2] as Extract<Speed, { kind: 'anim' }>);
    try {
      await this.animRound(token, sp, false);
    } finally {
      this.looping = false;
    }
  }

  /** Run to the end without animation */
  skipToEnd() {
    if (this.phase === 'finished') return;
    if (this.phase === 'setup' && !this.prepare()) return;
    this.skipping = true;
    this.interruptWait();
    if (this.phase === 'paused') this.resume();
    else this.ensureLoop();
  }

  setSpeed(i: number) {
    this.speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, i));
    this.acc = 0;
    if (this.speed.kind === 'turbo') this.interruptWait();
  }

  private interruptWait() {
    const f = this.interrupt;
    this.interrupt = null;
    f?.();
  }

  /** Wait for p, or until interruptWait() is called. Returns true if interrupted. */
  private async waitOrInterrupt(p: Promise<void>): Promise<boolean> {
    let interrupted = false;
    const cut = new Promise<void>((res) => {
      this.interrupt = () => {
        interrupted = true;
        res();
      };
    });
    await Promise.race([p, cut]);
    this.interrupt = null;
    return interrupted;
  }

  /** Back to the setup screen */
  reset() {
    this.hardReset(true);
  }

  rerollSeed() {
    this.inputs.seed = randomSeed();
  }

  private hardReset(toSetup: boolean) {
    this.runToken++;
    this.interruptWait();
    this.looping = false;
    this.skipping = false;
    this.onTable = null;
    this.showSummary = false;
    this.acc = 0;
    this.last = null;
    this.history = [];
    this.stage?.reset();
    if (toSetup) {
      this.engine = null;
      this.stats = null;
      this.series.reset(this.config.startBalance / 100);
      this.seriesVersion++;
      this.phase = 'setup';
    }
  }

  private ensureLoop() {
    if (this.looping) return;
    void this.loop(this.runToken);
  }

  private async loop(token: number) {
    this.looping = true;
    this.lastTs = performance.now();
    try {
      while (this.phase === 'running' && token === this.runToken) {
        const sp = this.speed;
        if (this.skipping) await this.turboFrame(token, Infinity, 40, false);
        else if (sp.kind === 'anim') await this.animRound(token, sp, true);
        else await this.turboFrame(token, sp.perSec, 12, true);
      }
    } finally {
      if (token === this.runToken) this.looping = false;
    }
  }

  private async animRound(token: number, sp: Extract<Speed, { kind: 'anim' }>, hold: boolean) {
    const e = this.engine;
    if (!e) return;
    const r = e.step();
    if (!r) {
      this.finish();
      return;
    }
    this.onTable = { round: r.round, bet: r.bet, balanceBefore: r.balanceBefore };
    const cut = await this.waitOrInterrupt(this.stage ? this.stage.spin(r, sp.spinMs) : delay(sp.spinMs));
    if (token !== this.runToken) return;
    if (cut) this.stage?.instant(r);
    this.onTable = null;
    this.series.push(r.round, r.balanceAfter / 100);
    this.seriesVersion++;
    this.stats = e.stats();
    this.last = r;
    this.history = [r, ...this.history].slice(0, HISTORY);
    if (r.ended) {
      this.finish();
      return;
    }
    if (hold && sp.holdMs > 0 && !this.skipping && this.speed.kind === 'anim') {
      await this.waitOrInterrupt(delay(sp.holdMs));
    }
    this.lastTs = performance.now();
  }

  private async turboFrame(token: number, perSec: number, budgetMs: number, drawStage: boolean) {
    await nextFrame();
    if (token !== this.runToken || this.phase !== 'running') return;
    const e = this.engine;
    if (!e) return;
    const now = performance.now();
    const dt = Math.min(100, Math.max(0, now - this.lastTs));
    this.lastTs = now;

    let n: number;
    if (Number.isFinite(perSec)) {
      this.acc += (perSec * dt) / 1000;
      n = Math.floor(this.acc);
      this.acc -= n;
    } else {
      n = Infinity;
    }
    if (n <= 0) return;

    const t0 = performance.now();
    const series = this.series;
    let i = 0;
    while (i < n) {
      if (!e.stepFast()) break;
      series.push(e.round, e.balance / 100);
      i++;
      if (e.ended) break;
      if ((i & 4095) === 0 && performance.now() - t0 > budgetMs) break;
    }
    if (i === 0) {
      if (e.ended) this.finish();
      return;
    }
    this.seriesVersion++;
    this.stats = e.stats();
    const recent = e.recent(HISTORY);
    this.last = recent[0] ?? null;
    this.history = recent;
    if (drawStage && this.last) this.stage?.instant(this.last);
    if (e.ended) this.finish();
  }

  private finish() {
    if (!this.engine) return;
    this.phase = 'finished';
    this.skipping = false;
    this.onTable = null;
    this.stats = this.engine.stats();
    this.last = this.engine.lastResult();
    if (this.last) this.stage?.instant(this.last);
    this.stage?.end(this.stats, this.last);
    this.seriesVersion++;
    setTimeout(() => {
      if (this.phase === 'finished') this.showSummary = true;
    }, 900);
  }
}
