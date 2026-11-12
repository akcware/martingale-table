// Engine tests — run with `npm test` (Node's built-in test runner, no extra dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MartingaleEngine, validateConfig, type RoundResult } from '../src/lib/engine/martingale.ts';
import { theory, monteCarlo, percentileOf } from '../src/lib/engine/analysis.ts';
import { SeriesBuffer } from '../src/lib/engine/series.ts';

const cfg = (over: Partial<ConstructorParameters<typeof MartingaleEngine>[0]> = {}) => ({
  rtp: 97.3,
  startBalance: 100_000,
  baseBet: 100,
  seed: 42,
  maxRounds: 10_000_000,
  ...over,
});

test('win rate matches RTP / 2 over many rounds', () => {
  const e = new MartingaleEngine(cfg({ startBalance: 1e12, seed: 7, maxRounds: 2_000_000 }));
  while (e.stepFast()) {}
  const s = e.stats();
  assert.equal(s.ended, 'cap');
  assert.ok(Math.abs(s.wins / s.round - 0.4865) < 0.002, `win rate ${s.wins / s.round}`);
});

test('balance always equals start + returned − wagered', () => {
  const e = new MartingaleEngine(cfg({ seed: 3 }));
  while (e.stepFast()) {}
  const s = e.stats();
  assert.equal(s.balance, s.startBalance + s.totalReturned - s.totalWagered);
});

test('hand-traced bust: 100 → 200 → 400 lost, 800 cannot be covered', () => {
  const e = new MartingaleEngine(cfg({ rtp: 0.0001, startBalance: 1000, baseBet: 100, seed: 1 }));
  const rounds: RoundResult[] = [];
  let r: RoundResult | null;
  while ((r = e.step())) rounds.push(r);
  assert.deepEqual(
    rounds.map((x) => [x.bet, x.balanceAfter, x.nextBet]),
    [
      [100, 900, 200],
      [200, 700, 400],
      [400, 300, 800],
    ],
  );
  assert.equal(rounds[2].ended, 'bust');
  assert.equal(e.stats().peakRound, 0);

  const t = theory({ rtp: 0.0001, startBalance: 1000, baseBet: 100 });
  assert.equal(t.maxLossStreak, 3);
  assert.equal(t.maxStake, 400);
  assert.equal(t.firstUncoveredStake, 800);
});

test('a win resets the stake and the game busts only when the next stake exceeds the balance', () => {
  const e = new MartingaleEngine(cfg({ seed: 11 }));
  let prev: RoundResult | null = null;
  let r: RoundResult | null;
  while ((r = e.step())) {
    if (prev) assert.equal(r.bet, prev.win ? 100 : prev.bet * 2);
    if (r.ended === 'bust') assert.ok(r.balanceAfter < r.nextBet);
    else assert.ok(r.balanceAfter >= r.nextBet);
    prev = r;
  }
});

test('peak balance and round match a manual replay', () => {
  const e = new MartingaleEngine(cfg());
  let peak = 100_000;
  let peakRound = 0;
  let r: RoundResult | null;
  while ((r = e.step())) {
    if (r.balanceAfter > peak) {
      peak = r.balanceAfter;
      peakRound = r.round;
    }
  }
  const s = e.stats();
  assert.equal(s.peakBalance, peak);
  assert.equal(s.peakRound, peakRound);
});

test('same seed → same game', () => {
  const a = new MartingaleEngine(cfg({ seed: 99 }));
  const b = new MartingaleEngine(cfg({ seed: 99 }));
  while (a.stepFast()) {}
  while (b.step()) {}
  assert.equal(a.round, b.round);
  assert.equal(a.balance, b.balance);
});

test('recent() returns newest first', () => {
  const e = new MartingaleEngine(cfg());
  for (let i = 0; i < 50 && e.stepFast(); i++) {}
  const rec = e.recent(5);
  assert.deepEqual(
    rec.map((x) => x.round),
    [e.round, e.round - 1, e.round - 2, e.round - 3, e.round - 4],
  );
});

test('validateConfig rejects bad input', () => {
  assert.ok(validateConfig(cfg({ baseBet: 200_000 })));
  assert.ok(validateConfig(cfg({ startBalance: 0 })));
  assert.ok(validateConfig(cfg({ rtp: 0 })));
  assert.equal(validateConfig(cfg()), null);
});

test('SeriesBuffer stays bounded and keeps spikes', () => {
  const sb = new SeriesBuffer(64);
  sb.reset(100);
  let max = -Infinity;
  for (let i = 1; i <= 10_000; i++) {
    const v = 100 + Math.sin(i) * 50 + (i === 5000 ? 999 : 0);
    max = Math.max(max, v);
    sb.push(i, v);
  }
  const v = sb.view();
  assert.ok(v.n <= 65);
  assert.equal(v.lastRound, 10_000);
  assert.equal(Math.max(...v.max), max);
  assert.equal(v.x[0], 0);
});

test('Monte Carlo: busts every time at a house edge, percentiles are ordered', async () => {
  const mc = await monteCarlo(cfg({ seed: 5 }), { sims: 500, budgetMs: 5000 });
  assert.ok(mc);
  assert.equal(mc.busted, mc.sims);
  assert.ok(mc.p10 <= mc.median && mc.median <= mc.p90);
  assert.equal(percentileOf(mc.sortedBust, mc.max + 1), 1);
  assert.equal(percentileOf(mc.sortedBust, 0), 0);
});
